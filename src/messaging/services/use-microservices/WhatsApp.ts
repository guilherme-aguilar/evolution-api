import { Injectable } from "@nestjs/common";
import { BaseMicroserviceMessageHandler, type IMessagePayload, type IMessageResult, type UniversalMessageService } from "../messaging.service";

@Injectable()
export class WhatsAppMicroservice extends BaseMicroserviceMessageHandler {
  constructor(
    universalService: UniversalMessageService,
    private readonly waMonitor?: any // Opcional - para não quebrar se não estiver disponível
  ) {
    super(universalService, 'whatsapp');
  }

  async onModuleInit(): Promise<void> {
    await this.startConsumer();
  }

  /**
   * Registra todos os handlers específicos do WhatsApp
   */
  registerServiceHandlers(): void {
    // Handler para mensagens de texto
    this.registerHandler('whatsapp_text', async (message) => {
      return await this.sendTextMessage(message);
    });

    // Handler para mensagens de mídia
    this.registerHandler('whatsapp_media', async (message) => {
      return await this.sendMediaMessage(message);
    });

    // Handler para mensagens de áudio
    this.registerHandler('whatsapp_audio', async (message) => {
      return await this.sendAudioMessage(message);
    });

    // Handler para stickers
    this.registerHandler('whatsapp_sticker', async (message) => {
      return await this.sendStickerMessage(message);
    });

    // Handler para documentos
    this.registerHandler('whatsapp_document', async (message) => {
      return await this.sendDocumentMessage(message);
    });

    // Handler para localização
    this.registerHandler('whatsapp_location', async (message) => {
      return await this.sendLocationMessage(message);
    });

    // Handler para contatos
    this.registerHandler('whatsapp_contact', async (message) => {
      return await this.sendContactMessage(message);
    });

    // Handler para botões/listas (Business API)
    this.registerHandler('whatsapp_interactive', async (message) => {
      return await this.sendInteractiveMessage(message);
    });
  }

  // ============================================================================
  // MÉTODOS PÚBLICOS DA API DO WHATSAPP
  // ============================================================================

  /**
   * Envia mensagem de texto
   */
  async queueTextMessage(instanceName: string, textData: any, options?: Partial<IMessagePayload>): Promise<string> {
    return await this.sendMessage({
      instanceName,
      event: 'whatsapp_text',
      requestData: textData,
      ...options,
    });
  }

  /**
   * Envia mensagem de mídia
   */
  async queueMediaMessage(instanceName: string, mediaData: any, options?: Partial<IMessagePayload>): Promise<string> {
    return await this.sendMessage({
      instanceName,
      event: 'whatsapp_media',
      requestData: mediaData,
      ...options,
    });
  }

  /**
   * Envia mensagem de áudio
   */
  async queueAudioMessage(instanceName: string, audioData: any, options?: Partial<IMessagePayload>): Promise<string> {
    return await this.sendMessage({
      instanceName,
      event: 'whatsapp_audio',
      requestData: audioData,
      ...options,
    });
  }

  /**
   * Agenda mensagem de texto
   */
  async scheduleTextMessage(instanceName: string, textData: any, scheduledAt: Date): Promise<string> {
    return await this.scheduleMessage({
      instanceName,
      event: 'whatsapp_text',
      requestData: textData,
    }, scheduledAt);
  }

  /**
   * Envia mensagem interativa (botões/listas)
   */
  async queueInteractiveMessage(instanceName: string, interactiveData: any, options?: Partial<IMessagePayload>): Promise<string> {
    return await this.sendMessage({
      instanceName,
      event: 'whatsapp_interactive',
      requestData: interactiveData,
      ...options,
    });
  }

  /**
   * Envia múltiplas mensagens em campanha
   */
  async queueBulkMessages(instanceName: string, messages: Array<{type: string, data: any}>, options?: Partial<IMessagePayload>): Promise<string[]> {
    const messagePromises = messages.map(msg => 
      this.sendMessage({
        instanceName,
        event: `whatsapp_${msg.type}`,
        requestData: msg.data,
        ...options,
      })
    );

    return await Promise.all(messagePromises);
  }

  // ============================================================================
  // HANDLERS PRIVADOS - IMPLEMENTAÇÃO DOS MÉTODOS DE ENVIO
  // ============================================================================

  private async sendTextMessage(message: IMessagePayload): Promise<IMessageResult> {
    const { instanceName, requestData } = message;

    if (!this.waMonitor?.waInstances[instanceName]) {
      throw new Error(`WhatsApp instance '${instanceName}' not found or not connected`);
    }

    const instance = this.waMonitor.waInstances[instanceName];
    const result = await instance.textMessage(requestData);

    return {
      messageId: message.messageId!,
      success: true,
      data: result,
      timestamp: new Date(),
    };
  }

  private async sendMediaMessage(message: IMessagePayload): Promise<IMessageResult> {
    const { instanceName, requestData } = message;

    if (!this.waMonitor?.waInstances[instanceName]) {
      throw new Error(`WhatsApp instance '${instanceName}' not found or not connected`);
    }

    const instance = this.waMonitor.waInstances[instanceName];
    const result = await instance.mediaMessage(requestData);

    return {
      messageId: message.messageId!,
      success: true,
      data: result,
      timestamp: new Date(),
    };
  }

  private async sendAudioMessage(message: IMessagePayload): Promise<IMessageResult> {
    const { instanceName, requestData } = message;

    if (!this.waMonitor?.waInstances[instanceName]) {
      throw new Error(`WhatsApp instance '${instanceName}' not found or not connected`);
    }

    const instance = this.waMonitor.waInstances[instanceName];
    const result = await instance.audioWhatsapp(requestData);

    return {
      messageId: message.messageId!,
      success: true,
      data: result,
      timestamp: new Date(),
    };
  }

  private async sendStickerMessage(message: IMessagePayload): Promise<IMessageResult> {
    const { instanceName, requestData } = message;

    if (!this.waMonitor?.waInstances[instanceName]) {
      throw new Error(`WhatsApp instance '${instanceName}' not found or not connected`);
    }

    const instance = this.waMonitor.waInstances[instanceName];
    const result = await instance.mediaSticker(requestData);

    return {
      messageId: message.messageId!,
      success: true,
      data: result,
      timestamp: new Date(),
    };
  }

  private async sendDocumentMessage(message: IMessagePayload): Promise<IMessageResult> {
    const { instanceName, requestData } = message;

    if (!this.waMonitor?.waInstances[instanceName]) {
      throw new Error(`WhatsApp instance '${instanceName}' not found or not connected`);
    }

    const instance = this.waMonitor.waInstances[instanceName];
    const result = await instance.mediaMessage({
      ...requestData,
      mediatype: 'document'
    });

    return {
      messageId: message.messageId!,
      success: true,
      data: result,
      timestamp: new Date(),
    };
  }

  private async sendLocationMessage(message: IMessagePayload): Promise<IMessageResult> {
    const { instanceName, requestData } = message;

    if (!this.waMonitor?.waInstances[instanceName]) {
      throw new Error(`WhatsApp instance '${instanceName}' not found or not connected`);
    }

    const instance = this.waMonitor.waInstances[instanceName];
    const result = await instance.locationMessage(requestData);

    return {
      messageId: message.messageId!,
      success: true,
      data: result,
      timestamp: new Date(),
    };
  }

  private async sendContactMessage(message: IMessagePayload): Promise<IMessageResult> {
    const { instanceName, requestData } = message;

    if (!this.waMonitor?.waInstances[instanceName]) {
      throw new Error(`WhatsApp instance '${instanceName}' not found or not connected`);
    }

    const instance = this.waMonitor.waInstances[instanceName];
    const result = await instance.contactMessage(requestData);

    return {
      messageId: message.messageId!,
      success: true,
      data: result,
      timestamp: new Date(),
    };
  }

  private async sendInteractiveMessage(message: IMessagePayload): Promise<IMessageResult> {
    const { instanceName, requestData } = message;

    if (!this.waMonitor?.waInstances[instanceName]) {
      throw new Error(`WhatsApp instance '${instanceName}' not found or not connected`);
    }

    const instance = this.waMonitor.waInstances[instanceName];
    // Assumindo que você tem um método para mensagens interativas
    const result = await instance.sendInteractive?.(requestData) || 
                   await instance.sendButtons?.(requestData) ||
                   await instance.sendList?.(requestData);

    return {
      messageId: message.messageId!,
      success: true,
      data: result,
      timestamp: new Date(),
    };
  }

  // ============================================================================
  // MÉTODOS CUSTOMIZADOS PARA WHATSAPP
  // ============================================================================

  /**
   * Override do método de falha para incluir lógica específica do WhatsApp
   */
  protected async handleFailedMessage(message: IMessagePayload, error: Error): Promise<void> {
    // Log específico para WhatsApp
    this.logger.error(`WhatsApp message failed - Instance: ${message.instanceName}, Event: ${message.event}, Error: ${error.message}`);

    // Verificar se é erro de instância desconectada
    if (error.message.includes('not found') || error.message.includes('not connected')) {
      // Talvez rejeitar sem retry se a instância estiver offline
      this.logger.warn(`WhatsApp instance ${message.instanceName} appears to be offline, moving to failed queue`);
      await this.handlePermanentFailure(message, error);
      return;
    }

    // Para outros erros, usar a lógica padrão de retry
    await super.handleFailedMessage(message, error);
  }

  /**
   * Override para falhas permanentes do WhatsApp
   */
  protected async handlePermanentFailure(message: IMessagePayload, error: Error): Promise<void> {
    // Implementar lógica específica para WhatsApp
    // Por exemplo, notificar admin sobre instância offline
    
    this.logger.error(`WhatsApp message permanently failed: ${message.messageId}`, {
      instanceName: message.instanceName,
      event: message.event,
      error: error.message,
      requestData: message.requestData,
    });

    // Você pode implementar webhook para notificar o sistema sobre falhas
    // await this.sendFailureWebhook(message, error);
  }


  /**
   * Obtém estatísticas específicas do WhatsApp
   */
  async getWhatsAppStats(): Promise<any> {
    const baseStats = await this.getServiceStats();
    const instancesStatus = [];

    return {
      ...baseStats,
      whatsAppSpecific: {
        instances: instancesStatus,
        supportedMessageTypes: [
          'whatsapp_text',
          'whatsapp_media', 
          'whatsapp_audio',
          'whatsapp_sticker',
          'whatsapp_document',
          'whatsapp_location',
          'whatsapp_contact',
          'whatsapp_interactive'
        ],
      },
    };
  }
}