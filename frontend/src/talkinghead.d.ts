declare module '@met4citizen/talkinghead' {
  export class TalkingHead {
    constructor(node: HTMLElement, opt?: Record<string, any>);
    showAvatar(avatar: Record<string, any>, onprogress?: any): Promise<void>;
    speakAudio(audio: any, opt?: any, onsubtitles?: any): void;
    stopSpeaking(): void;
    setMood(mood: string): void;
    start(): void;
    stop(): void;
    armature: any;
    scene: any;
    camera: any;
    [key: string]: any;
  }
}
