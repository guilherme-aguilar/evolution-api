import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as amqp from 'amqplib';
import { Logger } from '@config/logger.config';
import { QueuedMessage } from '../interfaces/message-queue.interface';
import { WAMonitoringService } from '@api/services/monitor.service';
import type { SendMediaDto, SendTextDto } from "@api/dto/sendMessage.dto";
import { v4 as uuidv4 } from 'uuid'; // no topo do arquivo, se não estiver já

@Injectable()
export class MessageConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MessageConsumerService');
  private connection: amqp.Connection;
  private channel: amqp.Channel;

  private readonly config = {
    url: process.env.RABBITMQ_URI || 'amqp://localhost:5672',
    exchange: 'whatsapp_messages',
    queues: {
      pending: 'whatsapp_pending',
      processing: 'whatsapp_processing',
      completed: 'whatsapp_completed',
      failed: 'whatsapp_failed',
      malformed: 'whatsapp_malformed'
    }
  };

  constructor(private readonly waMonitor: WAMonitoringService) { }

  async onModuleInit() {
    if (process.env.RABBITMQ_ENABLED === 'true' && process.env.RABBITMQ_CONSUMER_ENABLED === 'true') {
      await this.connect();
      await this.setupQueues();
      await this.startConsumer();
      this.logger.info('RabbitMQ MessageConsumerService initialized');
    }
  }

  private async connect(): Promise<void> {
    try {
      this.connection = await amqp.connect(this.config.url);
      this.channel = await this.connection.createChannel();

      this.connection.on('error', (err) => {
        this.logger.error('RabbitMQ connection error:' + err);
        setTimeout(() => this.reconnect(), 5000);
      });

      this.connection.on('close', () => {
        this.logger.warn('RabbitMQ connection closed. Reconnecting...');
        setTimeout(() => this.reconnect(), 5000);
      });

      this.logger.info('Connected to RabbitMQ (Consumer)');
    } catch (error) {
      this.logger.error('Failed to connect to RabbitMQ:' + error);
      throw error;
    }
  }

  private async reconnect(): Promise<void> {
    try {
      await this.connect();
      await this.setupQueues();
      if (process.env.RABBITMQ_CONSUMER_ENABLED === 'true') {
        await this.startConsumer();
      }
      this.logger.info('Reconnected to RabbitMQ (Consumer)');
    } catch (error) {
      this.logger.error('Failed to reconnect:' + error);
      setTimeout(() => this.reconnect(), 10000);
    }
  }

  private async setupQueues(): Promise<void> {
    try {
      // Exchange principal
      await this.channel.assertExchange(this.config.exchange, 'direct', {
        durable: true
      });

      // Todas as filas que o consumer precisa
      const queueOptions = {
        durable: true,
        arguments: {
          'x-max-priority': 10,
          'x-message-ttl': 24 * 60 * 60 * 1000, // TTL de 24h
        }
      };

      // Fila principal para mensagens pendentes
      await this.channel.assertQueue(this.config.queues.pending, queueOptions);
      await this.channel.bindQueue(this.config.queues.pending, this.config.exchange, 'pending');

      // Fila para mensagens sendo processadas
      await this.channel.assertQueue(this.config.queues.processing, queueOptions);
      await this.channel.bindQueue(this.config.queues.processing, this.config.exchange, 'processing');

      // Fila para mensagens completadas
      await this.channel.assertQueue(this.config.queues.completed, { durable: true });
      await this.channel.bindQueue(this.config.queues.completed, this.config.exchange, 'completed');

      // Fila para mensagens falhadas
      await this.channel.assertQueue(this.config.queues.failed, { durable: true });
      await this.channel.bindQueue(this.config.queues.failed, this.config.exchange, 'failed');

      // Fila para mensagens mal formadas
      await this.channel.assertQueue(this.config.queues.malformed, { durable: true });
      await this.channel.bindQueue(this.config.queues.malformed, this.config.exchange, 'malformed');


      this.logger.info('RabbitMQ consumer queues setup completed');
    } catch (error) {
      this.logger.error('Failed to setup consumer queues:' + error);
      throw error;
    }
  }

  /**
   * Inicia o consumer que processa mensagens da fila e envia via WhatsApp
   */
  private async startConsumer(): Promise<void> {
    try {
      await this.channel.prefetch(5); // Processar até 5 mensagens simultaneamente

      await this.channel.consume(
        this.config.queues.pending,
        async (msg) => {
          if (msg) {
            await this.processQueuedMessage(msg);
          }
        },
        { noAck: false }
      );

      this.logger.info('RabbitMQ consumer started - ready to send WhatsApp messages');
    } catch (error) {
      this.logger.error('Failed to start consumer:' + error);
      throw error;
    }
  }

  private async processQueuedMessage(msg: amqp.ConsumeMessage): Promise<void> {
    let messageData: QueuedMessage;

    // Parte 1: tentar parsear
    try {
      messageData = JSON.parse(msg.content.toString());
    } catch (parseError) {
      this.logger.info(`Failed to parse message: ${parseError}`);
      this.logger.debug(`Invalid message content: ${msg.content.toString()}`);

      const malformedMessage = {
        ...messageData,
        messageId: uuidv4(),
        retryCount: 1,
        malformedData: msg.content.toString('utf8'),
        metadata: { createdAt: new Date().toISOString() }
      };

      await this.moveToMalformed(malformedMessage, parseError.message);

      this.channel.ack(msg); // ou nack com requeue: false, se preferir
      return;
    }

    // Parte 2: garantir preenchimento automático
    messageData.messageId = messageData.messageId || uuidv4();
    messageData.retryCount = typeof messageData.retryCount === 'number' ? messageData.retryCount : 0;
    messageData.metadata = {
      createdAt: new Date().toISOString(),
      ...(messageData.metadata || {})
    };

    // Parte 3: tentar processar
    try {
      if (messageData.scheduledAt && new Date(messageData.scheduledAt) > new Date()) {
        this.channel.nack(msg, false, true);
        this.logger.info(`Message ${messageData.messageId} scheduled for later, requeued`);
        return;
      }

      await this.moveToProcessing(messageData);

      const result = await this.sendWhatsAppMessage(messageData);

      await this.moveToCompleted(messageData, result);

      this.channel.ack(msg);

      this.logger.info(`WhatsApp message sent successfully: ${messageData.messageId} (${messageData.event})`);

    } catch (error) {
      this.logger.error(`Failed to process queued message: ${error}`);

      const retryCount = messageData.retryCount || 0;
      const maxRetries = 3;

      if (retryCount < maxRetries) {
        messageData.retryCount = retryCount + 1;
        messageData.error = error.message;
        await this.requeueWithDelay(messageData, (retryCount + 1) * 5000);
        this.channel.ack(msg);
        this.logger.info(`Message requeued for retry ${retryCount + 1}/${maxRetries}`);
      } else {
        await this.moveToFailed(messageData, error.message);
        this.channel.ack(msg);
        this.logger.error(`Message moved to failed queue: ${messageData.messageId}`);
      }
    }
  }


  /**
   * CORE: Envia mensagem via WhatsApp baseado no tipo de evento
   */
  private async sendWhatsAppMessage(messageData: QueuedMessage): Promise<any> {
    const { instanceName, instanceId, event, requestData, encoding, notConvertSticker } = messageData;

    // Verificar se a instância existe
    if (!this.waMonitor.waInstances[instanceName]) {
      throw new Error(`WhatsApp instance '${instanceName}' not found or not connected`);
    }

    const instance = this.waMonitor.waInstances[instanceName];

    // Aplicar delay se especificado na metadata
    const delay = messageData.metadata?.delay;
    if (delay && delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Processar baseado no tipo de evento
    let result: any;

    switch (event) {
      case 'message_text':
        const textData = requestData as SendTextDto;
        result = await instance.textMessage(textData);
        break;

      case 'message_media':
        const mediaData = requestData as SendMediaDto;
        result = await instance.mediaMessage(mediaData);
        break;

      default:
        throw new Error(`Unsupported message event type: ${event}`);
    }

    // Armazenar o resultado da resposta no messageData para logging/audit
    messageData.responseData = result;

    return result;
  }

  private async moveToProcessing(messageData: QueuedMessage): Promise<void> {
    await this.channel.publish(
      this.config.exchange,
      'processing',
      Buffer.from(JSON.stringify({
        ...messageData,
        processingAt: new Date(),
        metadata: {
          ...messageData.metadata,
          processingAt: new Date()
        }
      })),
      { persistent: true }
    );
  }

  private async moveToCompleted(messageData: QueuedMessage, result: any): Promise<void> {
    await this.channel.publish(
      this.config.exchange,
      'completed',
      Buffer.from(JSON.stringify({
        ...messageData,
        completedAt: new Date(),
        responseData: result,
        metadata: {
          ...messageData.metadata,
          completedAt: new Date()
        }
      })),
      { persistent: true }
    );
  }

  private async moveToFailed(messageData: QueuedMessage, error: string): Promise<void> {
    await this.channel.publish(
      this.config.exchange,
      'failed',
      Buffer.from(JSON.stringify({
        ...messageData,
        failedAt: new Date(),
        error,
        metadata: {
          ...messageData.metadata,
          failedAt: new Date()
        }
      })),
      { persistent: true }
    );
  }

  private async moveToMalformed(messageData: QueuedMessage, error: string): Promise<void> {
    await this.channel.publish(
      this.config.exchange,
      'malformed',
      Buffer.from(JSON.stringify({
        ...messageData,
        failedAt: new Date(),
        error,
        metadata: {
          ...messageData.metadata,
          failedAt: new Date()
        }
      })),
      { persistent: true }
    );
  }

  private async requeueWithDelay(messageData: QueuedMessage, delay: number): Promise<void> {
    setTimeout(async () => {
      await this.channel.publish(
        this.config.exchange,
        'pending',
        Buffer.from(JSON.stringify(messageData)),
        {
          persistent: true,
          priority: this.getPriorityNumber(messageData.priority)
        }
      );
    }, delay);
  }

  /**
   * Converte prioridade string para número usado pelo RabbitMQ
   */
  private getPriorityNumber(priority?: 'low' | 'normal' | 'high'): number {
    switch (priority) {
      case 'high': return 10;
      case 'normal': return 5;
      case 'low': return 1;
      default: return 5;
    }
  }

  /**
   * Obtém estatísticas detalhadas das filas
   */
  async getQueueStats(): Promise<any> {
    if (!this.channel) return null;

    try {
      const stats = {};
      for (const [name, queue] of Object.entries(this.config.queues)) {
        const queueInfo = await this.channel.checkQueue(queue);
        stats[name] = {
          queue: queueInfo.queue,
          messageCount: queueInfo.messageCount,
          consumerCount: queueInfo.consumerCount
        };
      }
      return stats;
    } catch (error) {
      this.logger.error('Failed to get queue stats:' + error);
      return null;
    }
  }

  /**
   * Obtém mensagens de uma fila específica para monitoramento
   */
  async getQueueMessages(queueType: 'pending' | 'processing' | 'completed' | 'failed', limit: number = 10): Promise<QueuedMessage[]> {
    if (!this.channel) return [];

    try {
      const queueName = this.config.queues[queueType];
      const messages: QueuedMessage[] = [];

      // Esta é uma implementação básica - em produção você pode querer usar uma abordagem diferente
      // pois get() consome a mensagem da fila
      for (let i = 0; i < limit; i++) {
        const msg = await this.channel.get(queueName, { noAck: true });
        if (msg) {
          const messageData: QueuedMessage = JSON.parse(msg.content.toString());
          messages.push(messageData);
        } else {
          break; // Não há mais mensagens
        }
      }

      return messages;
    } catch (error) {
      this.logger.error(`Failed to get messages from ${queueType} queue: ${error}`);
      return [];
    }
  }

  async onModuleDestroy() {
    try {
      if (this.channel) await this.channel.close();
      if (this.connection) await this.connection.close();
      this.logger.info('RabbitMQ Consumer connection closed');
    } catch (error) {
      this.logger.error('Error closing RabbitMQ Consumer:' + error);
    }
  }
}