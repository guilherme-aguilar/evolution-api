
import { IMessageProvider, type IMessagePayload, type IMessageServiceConfig, type IQueueStats } from '../messaging.service';
import { Injectable } from '@nestjs/common';
import { Logger } from '@config/logger.config';
import * as amqp from 'amqplib';

@Injectable()
export class RabbitMQProvider extends IMessageProvider {
  private readonly logger = new Logger('RabbitMQProvider');
  private connection: amqp.Connection;
  private channel: amqp.Channel;
  private isConnectedFlag = false;

  constructor(private readonly config: IMessageServiceConfig) {
    super();
  }

  async connect(): Promise<void> {
    try {
      this.connection = await amqp.connect(this.config.connection.url);
      this.channel = await this.connection.createChannel();

      // Configurar eventos de reconexão
      this.connection.on('error', (err) => {
        this.logger.error(`Connection error: ${err.message}`);
        this.isConnectedFlag = false;
      });

      this.connection.on('close', () => {
        this.logger.warn('Connection closed. Attempting to reconnect...');
        this.isConnectedFlag = false;
        setTimeout(() => this.reconnect(), 5000);
      });

      // Setup das filas
      await this.setupQueues();
      
      this.isConnectedFlag = true;
      this.logger.log('Connected to RabbitMQ');
    } catch (error) {
      this.logger.error(`Failed to connect: ${error.message}`);
      throw error;
    }
  }

  private async reconnect(): Promise<void> {
    if (!this.isConnectedFlag) {
      try {
        await this.connect();
        this.logger.log('Reconnected to RabbitMQ');
      } catch (error) {
        this.logger.error(`Reconnection failed: ${error.message}`);
        setTimeout(() => this.reconnect(), 10000);
      }
    }
  }

  private async setupQueues(): Promise<void> {
    const exchange = 'universal_messages';
    
    await this.channel.assertExchange(exchange, 'direct', { durable: true });

    const queueOptions = {
      durable: true,
      arguments: this.config.options?.priority ? { 'x-max-priority': 10 } : {},
    };

    // Criar todas as filas necessárias
    for (const [key, queueName] of Object.entries(this.config.queues)) {
      if (queueName) {
        await this.channel.assertQueue(queueName, queueOptions);
        await this.channel.bindQueue(queueName, exchange, key);
      }
    }
  }

  async publish(queueType: string, message: IMessagePayload): Promise<string> {
    if (!this.isConnected()) {
      throw new Error('RabbitMQ not connected');
    }

    const messageId = message.messageId || this.generateId();
    const payload = {
      ...message,
      messageId,
      queuedAt: new Date(),
      retryCount: message.retryCount || 0,
    };

    const queueName = this.config.queues[queueType];
    if (!queueName) {
      throw new Error(`Queue type '${queueType}' not configured`);
    }

    const priority = this.getPriorityNumber(message.priority);
    
    const published = await this.channel.publish(
      'universal_messages',
      queueType,
      Buffer.from(JSON.stringify(payload)),
      {
        persistent: true,
        priority,
        messageId,
        timestamp: Date.now(),
      }
    );

    if (!published) {
      throw new Error('Failed to publish message');
    }

    return messageId;
  }

  async consume(queueType: string, handler: (message: IMessagePayload) => Promise<void>): Promise<void> {
    const queueName = this.config.queues[queueType];
    if (!queueName) {
      throw new Error(`Queue type '${queueType}' not configured`);
    }

    if (this.config.options?.prefetch) {
      await this.channel.prefetch(this.config.options.prefetch);
    }

    await this.channel.consume(queueName, async (msg) => {
      if (msg) {
        try {
          const payload: IMessagePayload = JSON.parse(msg.content.toString());
          await handler(payload);
          this.channel.ack(msg);
        } catch (error) {
          this.logger.error(`Error processing message: ${error.message}`);
          this.channel.nack(msg, false, false); // Rejeita sem reprocessar
        }
      }
    });
  }

  async getStats(): Promise<IQueueStats> {
    const stats: IQueueStats = {};
    
    for (const [key, queueName] of Object.entries(this.config.queues)) {
      if (queueName) {
        try {
          const info = await this.channel.checkQueue(queueName);
          stats[key] = {
            messageCount: info.messageCount,
            consumerCount: info.consumerCount,
          };
        } catch (error) {
          stats[key] = { messageCount: 0, consumerCount: 0 };
        }
      }
    }

    return stats;
  }

  async purgeQueue(queueType: string): Promise<void> {
    const queueName = this.config.queues[queueType];
    if (queueName) {
      await this.channel.purgeQueue(queueName);
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.channel) await this.channel.close();
      if (this.connection) await this.connection.close();
      this.isConnectedFlag = false;
      this.logger.log('Disconnected from RabbitMQ');
    } catch (error) {
      this.logger.error(`Error disconnecting: ${error.message}`);
    }
  }

  isConnected(): boolean {
    return this.isConnectedFlag && this.connection && !this.connection.destroyed;
  }

  private getPriorityNumber(priority?: string): number {
    switch (priority) {
      case 'high': return 10;
      case 'low': return 1;
      default: return 5;
    }
  }

  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}