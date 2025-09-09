

import type { SendMediaDto, SendTextDto } from "@api/dto/sendMessage.dto";
import type { mapTypeEvents } from "./type-events-and-dto.type";

export interface QueuedTextMessage {
  instanceName: string;
  number: string;
  text: string;
  delay?: number;
  quoted?: {
    key?: any;
    message?: any;
  };
  linkPreview?: boolean;
  mentionsEveryOne?: boolean;
  mentioned?: string[];
  encoding?: boolean;
  notConvertSticker?: boolean;
  
  // Metadados da fila
  messageId?: string;
  priority?: 'low' | 'normal' | 'high';
  scheduledAt?: Date; // Para agendar mensagens
  retryCount?: number;
  metadata?: {
    [key: string]: any;
  };
}

export interface QueuedMetadata {
  messageId?: string;
  priority?: 'low' | 'normal' | 'high';
  scheduledAt?: Date; // Para agendar mensagens
  retryCount?: number;
  metadata?: {
    [key: string]: any;
  };
}

// Tipo genérico que cria um tipo com event e requestData correspondentes
export type QueuedMessage<E extends keyof mapTypeEvents = keyof mapTypeEvents> = QueuedMetadata & {
  event: E;
  instanceName: string;
  instanceId?: string;
  requestData?: mapTypeEvents[E];
  malformedData?: string;
  responseData?: any;
  error?: any;
  encoding?: boolean;
  notConvertSticker?: boolean;
};
