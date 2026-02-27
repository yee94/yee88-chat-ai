// src/index.ts - DingTalk adapter for Chat SDK

export interface DingTalkAdapterOptions {
  // TODO: 添加钉钉配置选项
}

export function createDingTalkAdapter(options?: DingTalkAdapterOptions) {
  // TODO: 实现钉钉适配器
  return {
    name: 'dingtalk' as const,
    options,
  };
}

export * from './types.ts';
