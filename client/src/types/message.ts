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
  voiceUrl: string;    // 音频 URL 或 base64
  durationMs: number;  // 时长，毫秒
}

export type Message = TextMessage | VoiceMessage;
