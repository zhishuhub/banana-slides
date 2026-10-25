import { apiClient } from './client';
import type { ApiResponse } from '@/types';

/** 一键接入状态：AI 调用地址和密钥都由网站发的接入码换来。 */
export interface ZhishuStatus {
  connected: boolean;
  user_name: string;
  /** 用户所在网站的地址，检查更新、跳转下载都用它 */
  site_origin: string;
  app_key: string;
  /** 接入失败或接入失效时给用户看的提示 */
  message: string;
}

export const ZHISHU_CODE_PATTERN = /APP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/;

export const getZhishuStatus = async (verify = false): Promise<ZhishuStatus> => {
  const response = await apiClient.get<ApiResponse<ZhishuStatus>>('/api/zhishu/status', {
    params: verify ? { verify: 1 } : undefined,
  });
  return response.data.data as ZhishuStatus;
};

export const connectZhishu = async (code: string): Promise<ZhishuStatus> => {
  const response = await apiClient.post<ApiResponse<ZhishuStatus>>('/api/zhishu/connect', { code });
  return response.data.data as ZhishuStatus;
};

export const disconnectZhishu = async (): Promise<ZhishuStatus> => {
  const response = await apiClient.post<ApiResponse<ZhishuStatus>>('/api/zhishu/disconnect');
  return response.data.data as ZhishuStatus;
};

/** 网站上这个应用的最新版本号（公开接口），取不到返回空。 */
export const getLatestAppVersion = async (status: ZhishuStatus): Promise<string> => {
  try {
    const response = await fetch(`${status.site_origin}/api/apps/${status.app_key}`);
    const result = await response.json();
    return result?.success ? String(result.data?.version || '') : '';
  } catch {
    return '';
  }
};
