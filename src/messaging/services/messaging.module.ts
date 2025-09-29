
// ============================================================================
// CONFIGURAÇÃO E MODULE
// ============================================================================

import { Module } from "@nestjs/common";
import { UniversalMessageService, type IMessageServiceConfig } from "./messaging.service";

export const MESSAGE_SERVICE_CONFIG = Symbol('MESSAGE_SERVICE_CONFIG');

@Module({
  providers: [
    {
      provide: MESSAGE_SERVICE_CONFIG,
      useValue: {
        enabled: process.env.MESSAGE_SERVICE_ENABLED === 'true',
        provider: process.env.MESSAGE_SERVICE_PROVIDER || 'rabbitmq',
        connection: {
          url: process.env.MESSAGE_SERVICE_URL || 'amqp://localhost:5672',
        },
        queues: {
          pending: 'universal_pending',
          processing: 'universal_processing',
          completed: 'universal_completed',
          failed: 'universal_failed',
          malformed: 'universal_malformed',
        },
        options: {
          maxRetries: 3,
          retryDelay: 5000,
          prefetch: 5,
          priority: true,
        },
      } as IMessageServiceConfig,
    },
    {
      provide: UniversalMessageService,
      useFactory: (config: IMessageServiceConfig) => {
        return new UniversalMessageService(config);
      },
      inject: [MESSAGE_SERVICE_CONFIG],
    },
  ],
  exports: [UniversalMessageService],
})

export class UniversalMessageModule {}