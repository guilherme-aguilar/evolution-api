import type { SendMediaDto, SendTextDto } from "@api/dto/sendMessage.dto";

// Mapear o evento para o tipo correto
export type mapTypeEvents = {
  "message_text": SendTextDto;
  "message_media": SendMediaDto;
};
