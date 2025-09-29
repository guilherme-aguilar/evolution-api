import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as amqp from 'amqplib';
import { Logger } from '@config/logger.config';
import { QueuedTextMessage } from '../interfaces/message-queue.interface';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class MessageProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MessageProducerService');
  private connection: amqp.Connection;
  private channel: amqp.Channel;
  
  private readonly config = {
    url: process.env.RABBITMQ_URI || 'amqp://localhost:5672',
    exchange: 'whatsapp_messages',
    queues: {
      pending: 'whatsapp_pending',
      completed: 'whatsapp_completed',
      failed: 'whatsapp_failed'
    }
  };

  async onModuleInit() {
    if (process.env.RABBITMQ_ENABLED === 'true') {
      await this.connect();
      await this.setupQueues();
      this.logger.info('RabbitMQ MessageProducerService initialized');
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

      this.logger.info('Connected to RabbitMQ (Producer)');
    } catch (error) {
      this.logger.error('Failed to connect to RabbitMQ:' + error);
      throw error;
    }
  }

  private async reconnect(): Promise<void> {
    try {
      await this.connect();
      await this.setupQueues();
      this.logger.info('Reconnected to RabbitMQ (Producer)');
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

      // Apenas as filas que o producer precisa conhecer
      const queueOptions = {
        durable: true,
        arguments: {
          'x-max-priority': 10,
          'x-message-ttl': 24 * 60 * 60 * 1000, // TTL de 24h
        }
      };

      await this.channel.assertQueue(this.config.queues.pending, queueOptions);
      await this.channel.bindQueue(this.config.queues.pending, this.config.exchange, 'pending');

      this.logger.info('RabbitMQ producer queues setup completed');
    } catch (error) {
      this.logger.error('Failed to setup producer queues:' + error);
      throw error;
    }
  }

  /**
   * Adiciona uma mensagem de texto na fila para envio automático
   */
  async queueTextMessage(messageData: QueuedTextMessage): Promise<string> {


     await this.ensureConnection();
     
    if (!this.channel) {
      throw new Error('RabbitMQ channel not available');
    }

    try {
      const messageId = messageData.messageId || uuidv4();
      const payload = {
        ...messageData,
        messageId,
        queuedAt: new Date(),
        retryCount: 0
      };

      // Definir prioridade (high=10, normal=5, low=1)
      const priority = messageData.priority === 'high' ? 10 : 
                      messageData.priority === 'low' ? 1 : 5;

      const published = await this.channel.publish(
        this.config.exchange,
        'pending',
        Buffer.from(JSON.stringify(payload)),
        {
          persistent: true,
          priority,
          timestamp: Date.now(),
          messageId,
          headers: {
            'instance-name': messageData.instanceName,
            'recipient': messageData.number,
            'message-type': 'text',
            'priority': messageData.priority || 'normal'
          }
        }
      );

      if (published) {
        this.logger.info(`Message queued for sending: ${messageId}`);
        return messageId;
      } else {
        throw new Error('Failed to publish message to queue');
      }
    } catch (error) {
      this.logger.error('Failed to queue message:' + error);
      throw error;
    }
  }

  /**
   * Agenda uma mensagem para ser enviada em data/hora específica
   */
  async scheduleTextMessage(messageData: QueuedTextMessage, scheduledAt: Date): Promise<string> {
    return await this.queueTextMessage({
      ...messageData,
      scheduledAt
    });
  }

  /**
   * Obtém estatísticas das filas (apenas leitura)
   */
  async getQueueStats(): Promise<any> {
    if (!this.channel) return null;

    try {
      const stats = {};
      for (const [name, queue] of Object.entries(this.config.queues)) {
        try {
          const queueInfo = await this.channel.checkQueue(queue);
          stats[name] = {
            queue: queueInfo.queue,
            messageCount: queueInfo.messageCount,
            consumerCount: queueInfo.consumerCount
          };
        } catch (error) {
          // Fila pode não existir ainda
          stats[name] = { error: 'Queue not accessible' };
        }
      }
      return stats;
    } catch (error) {
      this.logger.error('Failed to get queue stats:' + error);
      return null;
    }
  }

  async onModuleDestroy() {
    try {
      if (this.channel) await this.channel.close();
      if (this.connection) await this.connection.close();
      this.logger.info('RabbitMQ Producer connection closed');
    } catch (error) {
      this.logger.error('Error closing RabbitMQ Producer:' + error);
    }
  }

  private connectingPromise: Promise<void> | null = null;

private async ensureConnection(): Promise<void> {
  if (this.channel) return;

  if (this.connectingPromise) {
    // Se já está tentando conectar, aguarde
    await this.connectingPromise;
    return;
  }

  this.connectingPromise = (async () => {
    await this.connect();
    await this.setupQueues();
    this.connectingPromise = null;
  })();

  await this.connectingPromise;
}

}