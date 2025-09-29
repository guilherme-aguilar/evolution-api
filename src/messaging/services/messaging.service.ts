// ============================================================================
// CORE - INTERFACES E TIPOS BASE
// ============================================================================

export interface IMessagePayload {
  messageId?: string;
  instanceName?: string;
  instanceId?: string;
  event: string;
  requestData: any;
  priority?: 'low' | 'normal' | 'high';
  scheduledAt?: Date;
  delay?: number;
  retryCount?: number;
  encoding?: string;
  metadata?: Record<string, any>;
}

export interface IMessageResult {
  messageId: string;
  success: boolean;
  data?: any;
  error?: string;
  timestamp: Date;
}

export interface IQueueStats {
  [queueName: string]: {
    messageCount: number;
    consumerCount?: number;
    processing?: number;
    failed?: number;
  };
}

export interface IMessageServiceConfig {
  enabled: boolean;
  provider: 'rabbitmq' | 'redis' | 'sqs' | 'memory';
  connection: {
    url?: string;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    [key: string]: any;
  };
  queues: {
    pending: string;
    processing?: string;
    completed?: string;
    failed?: string;
    malformed?: string;
  };
  options?: {
    maxRetries?: number;
    retryDelay?: number;
    prefetch?: number;
    ttl?: number;
    priority?: boolean;
  };
}

// ============================================================================
// CORE - PROVIDER ABSTRATO
// ============================================================================

export abstract class IMessageProvider {
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract publish(queue: string, message: IMessagePayload): Promise<string>;
  abstract consume(queue: string, handler: (message: IMessagePayload) => Promise<void>): Promise<void>;
  abstract getStats(): Promise<IQueueStats>;
  abstract purgeQueue(queue: string): Promise<void>;
  abstract isConnected(): boolean;
}

// ============================================================================
// CORE - SERVIÇO UNIVERSAL BASE (SEM HANDLERS ESPECÍFICOS)
// ============================================================================

import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

@Injectable()
export class UniversalMessageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('UniversalMessageService');
  private provider: IMessageProvider;

  constructor(private readonly config: IMessageServiceConfig) {}

  async onModuleInit() {
    if (!this.config.enabled) {
      this.logger.log('Message service disabled');
      return;
    }

    // Factory pattern para criar o provider correto
    this.provider = this.createProvider();
    await this.provider.connect();
    
    this.logger.log(`Universal Message Service initialized with ${this.config.provider}`);
  }

  private createProvider(): IMessageProvider {
    switch (this.config.provider) {
      case 'rabbitmq':
        // Importar dinamicamente para evitar dependências desnecessárias
        const { RabbitMQProvider } = require('./providers/rabbitmq.provider');
        return new RabbitMQProvider(this.config);
      // case 'redis':
      //   const { RedisProvider } = require('./providers/redis.provider');
      //   return new RedisProvider(this.config);
      // case 'sqs':
      //   const { SQSProvider } = require('./providers/sqs.provider');
      //   return new SQSProvider(this.config);
      // case 'memory':
      //   const { MemoryProvider } = require('./providers/memory.provider');
      //   return new MemoryProvider(this.config);
      default:
        throw new Error(`Unsupported provider: ${this.config.provider}`);
    }
  }

  // ============================================================================
  // MÉTODOS PÚBLICOS - PUBLISHER
  // ============================================================================

  /**
   * Envia mensagem para fila
   */
  async sendMessage(message: IMessagePayload): Promise<string> {
    if (!this.provider?.isConnected()) {
      throw new Error('Message service not connected');
    }

    // Garantir messageId único
    if (!message.messageId) {
      message.messageId = this.generateMessageId();
    }

    return await this.provider.publish('pending', message);
  }

  /**
   * Agenda mensagem para envio futuro
   */
  async scheduleMessage(message: IMessagePayload, scheduledAt: Date): Promise<string> {
    return await this.sendMessage({
      ...message,
      scheduledAt,
    });
  }

  /**
   * Envia mensagem com prioridade alta
   */
  async sendPriorityMessage(message: IMessagePayload): Promise<string> {
    return await this.sendMessage({
      ...message,
      priority: 'high',
    });
  }

  /**
   * Envia múltiplas mensagens em lote
   */
  async sendBulkMessages(messages: IMessagePayload[]): Promise<string[]> {
    const messageIds: string[] = [];
    
    for (const message of messages) {
      const messageId = await this.sendMessage(message);
      messageIds.push(messageId);
    }

    return messageIds;
  }

  // ============================================================================
  // MÉTODOS PÚBLICOS - MONITORAMENTO
  // ============================================================================

  /**
   * Obtém estatísticas das filas
   */
  async getQueueStats(): Promise<IQueueStats> {
    if (!this.provider) return {};
    return await this.provider.getStats();
  }

  /**
   * Limpa uma fila específica
   */
  async purgeQueue(queueType: string): Promise<void> {
    if (!this.provider) return;
    await this.provider.purgeQueue(queueType);
    this.logger.log(`Queue '${queueType}' purged`);
  }

  /**
   * Verifica se o serviço está conectado
   */
  isHealthy(): boolean {
    return this.provider?.isConnected() || false;
  }

  /**
   * Obtém configuração atual
   */
  getConfig(): IMessageServiceConfig {
    return { ...this.config };
  }

  // ============================================================================
  // MÉTODOS UTILITÁRIOS
  // ============================================================================

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async onModuleDestroy() {
    if (this.provider) {
      await this.provider.disconnect();
      this.logger.log('Universal Message Service destroyed');
    }
  }
}

// ============================================================================
// ABSTRACT - CLASSE BASE PARA MICROSERVICES
// ============================================================================

export abstract class BaseMicroserviceMessageHandler {
  protected readonly logger = new Logger(this.constructor.name);
  protected messageHandlers: Map<string, (message: IMessagePayload) => Promise<IMessageResult>> = new Map();

  constructor(
    protected readonly universalService: UniversalMessageService,
    protected readonly serviceName: string
  ) {}

  /**
   * Método abstrato que cada microservice deve implementar
   * para definir seus handlers específicos
   */
  abstract registerServiceHandlers(): void;

  /**
   * Inicia o consumer para este microservice específico
   */
  async startConsumer(): Promise<void> {
    if (!this.universalService.isHealthy()) {
      throw new Error(`Universal Message Service not healthy for ${this.serviceName}`);
    }

    // Registrar handlers específicos do serviço
    this.registerServiceHandlers();

    // Configurar consumer específico para este serviço
    await this.setupServiceConsumer();

    this.logger.log(`${this.serviceName} message consumer started`);
  }

  /**
   * Registra um handler para um evento específico
   */
  protected registerHandler(event: string, handler: (message: IMessagePayload) => Promise<IMessageResult>): void {
    this.messageHandlers.set(event, handler);
    this.logger.log(`Handler registered for event: ${event} in ${this.serviceName}`);
  }

  /**
   * Remove handler de um evento
   */
  protected unregisterHandler(event: string): void {
    this.messageHandlers.delete(event);
    this.logger.log(`Handler unregistered for event: ${event} in ${this.serviceName}`);
  }

  /**
   * Envia mensagem usando o serviço universal
   */
  protected async sendMessage(message: IMessagePayload): Promise<string> {
    // Adicionar metadata do serviço
    const enrichedMessage: IMessagePayload = {
      ...message,
      metadata: {
        ...message.metadata,
        serviceOrigin: this.serviceName,
        timestamp: new Date().toISOString(),
      },
    };

    return await this.universalService.sendMessage(enrichedMessage);
  }

  /**
   * Agenda mensagem usando o serviço universal
   */
  protected async scheduleMessage(message: IMessagePayload, scheduledAt: Date): Promise<string> {
    return await this.universalService.scheduleMessage({
      ...message,
      metadata: {
        ...message.metadata,
        serviceOrigin: this.serviceName,
        timestamp: new Date().toISOString(),
      },
    }, scheduledAt);
  }

  /**
   * Configura o consumer específico do serviço
   * Override este método se precisar de lógica específica
   */
  protected async setupServiceConsumer(): Promise<void> {
    // Implementação padrão - pode ser sobrescrita
    const config = this.universalService.getConfig();
    
    // Aqui você pode configurar consumers específicos do serviço
    // Por exemplo, filtrar mensagens por serviceOrigin ou event pattern
    
    this.logger.log(`Service consumer setup completed for ${this.serviceName}`);
  }

  /**
   * Processa mensagem específica do serviço
   */
  protected async processServiceMessage(message: IMessagePayload): Promise<void> {
    const { event, messageId } = message;

    try {
      // Verificar se a mensagem está agendada
      if (message.scheduledAt && new Date(message.scheduledAt) > new Date()) {
        throw new Error('Message scheduled for later');
      }

      // Aplicar delay se especificado
      if (message.delay && message.delay > 0) {
        await new Promise(resolve => setTimeout(resolve, message.delay));
      }

      // Buscar handler para o evento
      const handler = this.messageHandlers.get(event);
      if (!handler) {
        throw new Error(`No handler registered for event: ${event} in ${this.serviceName}`);
      }

      // Processar mensagem
      const result = await handler(message);

      // Log do sucesso
      this.logger.log(`Message processed successfully: ${messageId} (${event}) in ${this.serviceName}`);

      // Você pode enviar para completed queue se necessário
      await this.handleSuccessfulMessage(message, result);

    } catch (error) {
      this.logger.error(`Failed to process message ${messageId} in ${this.serviceName}: ${error.message}`);
      await this.handleFailedMessage(message, error);
    }
  }

  /**
   * Manipula mensagens processadas com sucesso
   * Override para customizar comportamento
   */
  protected async handleSuccessfulMessage(message: IMessagePayload, result: IMessageResult): Promise<void> {
    // Implementação padrão - pode ser sobrescrita
    // Por exemplo, enviar para completed queue, webhook, etc.
  }

  /**
   * Manipula mensagens que falharam
   * Override para customizar comportamento de retry
   */
  protected async handleFailedMessage(message: IMessagePayload, error: Error): Promise<void> {
    // Implementação padrão de retry - pode ser sobrescrita
    const retryCount = (message.retryCount || 0) + 1;
    const config = this.universalService.getConfig();
    const maxRetries = config.options?.maxRetries || 3;

    if (retryCount <= maxRetries) {
      // Retry com delay exponencial
      const retryDelay = (config.options?.retryDelay || 5000) * retryCount;
      
      setTimeout(async () => {
        await this.sendMessage({
          ...message,
          retryCount,
          metadata: { 
            ...message.metadata, 
            lastError: error.message,
            nextRetry: new Date(Date.now() + retryDelay),
            serviceOrigin: this.serviceName,
          },
        });
      }, retryDelay);

      this.logger.log(`Message requeued for retry ${retryCount}/${maxRetries}: ${message.messageId}`);
    } else {
      this.logger.error(`Message failed permanently: ${message.messageId} in ${this.serviceName}`);
      
      // Enviar para failed queue ou sistema de alertas
      await this.handlePermanentFailure(message, error);
    }
  }

  /**
   * Manipula falhas permanentes
   * Override para customizar comportamento
   */
  protected async handlePermanentFailure(message: IMessagePayload, error: Error): Promise<void> {
    // Implementação padrão - pode ser sobrescrita
    // Por exemplo, enviar alerta, salvar em DLQ, etc.
  }

  /**
   * Obtém estatísticas específicas do serviço
   */
  async getServiceStats(): Promise<any> {
    const stats = await this.universalService.getQueueStats();
    
    return {
      serviceName: this.serviceName,
      handlersCount: this.messageHandlers.size,
      registeredEvents: Array.from(this.messageHandlers.keys()),
      queueStats: stats,
      timestamp: new Date(),
    };
  }
}
