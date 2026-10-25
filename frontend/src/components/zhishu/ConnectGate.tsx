import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { PlugZap } from 'lucide-react';
import { useT } from '@/hooks/useT';
import { Button } from '@/components/shared/Button';
import {
  connectZhishu,
  disconnectZhishu,
  getZhishuStatus,
  ZHISHU_CODE_PATTERN,
  type ZhishuStatus,
} from '@/api/zhishu';

const translations = {
  zh: {
    title: '先接入 AI',
    lead: '接入后用你在网站上的账号生成 PPT，费用从余额扣除。',
    step1: '回到网站，在「我的应用」里找到本应用，点「一键接入」，接入码会自动复制。',
    step2: '回到这里，接入码会被自动识别；没反应就粘贴到下面的输入框。',
    placeholder: 'APP-XXXX-XXXX-XXXX',
    paste: '粘贴',
    connecting: '正在接入…',
    noCode: '剪贴板里没有接入码，请回到网站重新点「一键接入」',
    connectError: '无法连接到本地服务，请重启应用后再试',
    retry: '重试',
  },
  en: {
    title: 'Connect AI first',
    lead: 'Once connected, slides are generated with your account on the website and billed to your balance.',
    step1: 'On the website, open "My apps", find this app and click "Connect in one click". The connect code is copied automatically.',
    step2: 'Come back here and the code is detected automatically. If nothing happens, paste it below.',
    placeholder: 'APP-XXXX-XXXX-XXXX',
    paste: 'Paste',
    connecting: 'Connecting…',
    noCode: 'No connect code on the clipboard. Click "Connect in one click" on the website again.',
    connectError: 'Cannot reach the local service. Restart the app and try again.',
    retry: 'Retry',
  },
};

type ElectronClipboardApi = {
  readClipboardText?: () => Promise<string>;
  clearClipboardText?: (expected: string) => Promise<void>;
};

const electronApi = () => (window as typeof window & { electronAPI?: ElectronClipboardApi }).electronAPI;

async function readClipboard(): Promise<string> {
  try {
    const api = electronApi();
    if (api?.readClipboardText) return (await api.readClipboardText()) || '';
    return await navigator.clipboard.readText();
  } catch {
    return '';
  }
}

type ZhishuContextValue = {
  status: ZhishuStatus | null;
  /** 清掉当前接入，回到接入页 */
  reconnect: () => Promise<void>;
};

const ZhishuContext = createContext<ZhishuContextValue>({ status: null, reconnect: async () => {} });

/** 取接入状态（用户名、网站地址），设置页和更新提示用。 */
export const useZhishuConnection = () => useContext(ZhishuContext);

/** 接入前只显示接入页；接入后定期确认接入还有效，在网站停止授权后回到接入页。 */
export function ConnectGate({ children }: { children: ReactNode }) {
  const t = useT(translations);
  const [status, setStatus] = useState<ZhishuStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [code, setCode] = useState('');
  const [tip, setTip] = useState('');
  const [connecting, setConnecting] = useState(false);
  const connectingRef = useRef(false);
  const lastVerifyRef = useRef(0);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const next = await getZhishuStatus(true);
      lastVerifyRef.current = Date.now();
      setStatus(next);
      setTip(next.message || '');
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const tryConnect = useCallback(async (raw: string, fromClipboard: boolean) => {
    const match = raw.toUpperCase().match(ZHISHU_CODE_PATTERN);
    if (!match || connectingRef.current) return;
    connectingRef.current = true;
    setConnecting(true);
    setTip(t('connecting'));
    try {
      const next = await connectZhishu(match[0]);
      setStatus(next);
      setTip(next.message || '');
      if (next.connected) {
        setCode('');
        if (fromClipboard) await electronApi()?.clearClipboardText?.(raw);
      }
    } catch {
      setTip(t('connectError'));
    } finally {
      connectingRef.current = false;
      setConnecting(false);
    }
  }, [t]);

  // 没接入时：打开和切回窗口都读一次剪贴板；接入后：切回窗口时（最多一分钟一次）确认接入还有效
  useEffect(() => {
    if (!status) return;
    const onFocus = async () => {
      if (!status.connected) {
        const text = await readClipboard();
        if (ZHISHU_CODE_PATTERN.test(text.toUpperCase())) tryConnect(text, true);
        return;
      }
      if (Date.now() - lastVerifyRef.current < 60_000) return;
      lastVerifyRef.current = Date.now();
      try {
        const next = await getZhishuStatus(true);
        if (!next.connected) {
          setStatus(next);
          setTip(next.message || '');
        }
      } catch {
        // 本地服务暂时没响应时不打扰用户，下次再查
      }
    };
    if (!status.connected) onFocus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [status, tryConnect]);

  const reconnect = useCallback(async () => {
    const next = await disconnectZhishu();
    setStatus(next);
    setTip('');
  }, []);

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background-primary">
        <div className="w-80 p-6 rounded-2xl bg-white dark:bg-background-secondary shadow-lg border border-gray-200 dark:border-border-primary text-center">
          <p className="text-gray-600 dark:text-foreground-secondary mb-4">{t('connectError')}</p>
          <Button className="w-full" onClick={load}>{t('retry')}</Button>
        </div>
      </div>
    );
  }
  if (!status) return null;
  if (status.connected) {
    return <ZhishuContext.Provider value={{ status, reconnect }}>{children}</ZhishuContext.Provider>;
  }

  const isError = !!tip && tip !== t('connecting');
  return (
    <div className="min-h-screen flex items-center justify-center bg-background-primary px-4">
      <div className="w-full max-w-lg p-8 rounded-2xl bg-white dark:bg-background-secondary shadow-lg border border-gray-200 dark:border-border-primary">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-banana-100 dark:bg-banana/20 flex items-center justify-center mb-3">
            <PlugZap size={24} className="text-banana-700 dark:text-banana" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-foreground-primary">{t('title')}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-foreground-tertiary">{t('lead')}</p>
        </div>
        <ol className="space-y-3 mb-6 text-sm text-gray-700 dark:text-foreground-secondary">
          {[t('step1'), t('step2')].map((text, index) => (
            <li key={index} className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-banana-100 dark:bg-banana/20 text-banana-800 dark:text-banana text-xs font-semibold flex items-center justify-center">
                {index + 1}
              </span>
              <span className="pt-0.5">{text}</span>
            </li>
          ))}
        </ol>
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              tryConnect(event.target.value, false);
            }}
            placeholder={t('placeholder')}
            spellCheck={false}
            autoFocus
            className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-300 dark:border-border-primary bg-white dark:bg-background-primary text-gray-900 dark:text-foreground-primary uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-banana-500"
          />
          <Button
            variant="secondary"
            loading={connecting}
            onClick={async () => {
              const text = await readClipboard();
              setCode(text.trim());
              if (!ZHISHU_CODE_PATTERN.test(text.toUpperCase())) {
                setTip(t('noCode'));
                return;
              }
              tryConnect(text, true);
            }}
          >
            {t('paste')}
          </Button>
        </div>
        <p className={`mt-3 min-h-[1.25rem] text-sm ${isError ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-foreground-tertiary'}`}>
          {tip}
        </p>
      </div>
    </div>
  );
}
