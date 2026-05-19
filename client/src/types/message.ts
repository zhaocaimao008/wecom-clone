export interface BaseMessage {
  id: number;
  sender_id: number;
  sender_name: string;
  sender_color: string;
  receiver_id?: number;
  group_id?: number;
  recalled: 0 | 1;
  created_at: string;
}

export interface TextMessage extends BaseMessage {
  type: 'text';
  content: string;
}

export interface VoiceMessage extends BaseMessage {
  type: 'voice';
  voiceUrl: string;
  durationMs: number;
}

export interface FileMessage extends BaseMessage {
  type: 'file';
  fileUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export interface CardMessage extends BaseMessage {
  type: 'card';
  userId: number;
  name: string;
  department: string;
  position: string;
  color: string;
}

export type Message = TextMessage | VoiceMessage | FileMessage | CardMessage;
