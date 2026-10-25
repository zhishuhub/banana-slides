import { useEffect, useState } from 'react';
import { ArrowUpRight, Info, PlugZap, RefreshCw, X } from 'lucide-react';
import { useT } from '@/hooks/useT';
import { Button } from '@/components/shared/Button';
import { getLatestAppVersion, type ZhishuStatus } from '@/api/zhishu';
import { useZhishuConnection } from './ConnectGate';

const SOURCE_URL = 'https://github.com/zhishuhub/banana-slides';
const UPSTREAM_URL = 'https://github.com/Anionex/banana-slides';

const translations = {
  zh: {
    accountTitle: 'AI 服务',
    connectedAs: '已接入：{{name}}',
    accountDesc: '对话和生图都用你在网站上的账号调用，费用从余额扣除；额度上限和停止授权在网站「我的应用」里设置。',
    reconnect: '重新接入',
    aboutTitle: '关于',
    version: '版本',
    checkUpdate: '检查更新',
    checking: '检查中…',
    upToDate: '已是最新版本',
    checkFailed: '检查更新失败，请稍后再试',
    newVersion: '有新版本 {{version}}',
    download: '去网站下载',
    later: '稍后',
    attribution: '基于 Banana Slides 开源项目修改，遵循 AGPL-3.0 协议。',
    source: '源代码',
    upstream: '原项目',
  },
  en: {
    accountTitle: 'AI service',
    connectedAs: 'Connected: {{name}}',
    accountDesc: 'Chat and image generation use your account on the website and are billed to your balance. Set usage caps or stop authorization under "My apps" on the website.',
    reconnect: 'Reconnect',
    aboutTitle: 'About',
    version: 'Version',
    checkUpdate: 'Check for updates',
    checking: 'Checking…',
    upToDate: 'You are on the latest version',
    checkFailed: 'Could not check for updates. Try again later.',
    newVersion: 'Version {{version}} is available',
    download: 'Download on the website',
    later: 'Later',
    attribution: 'Modified from the Banana Slides open-source project under AGPL-3.0.',
    source: 'Source code',
    upstream: 'Original project',
  },
};

type DesktopApi = {
  getAppVersion?: () => Promise<string>;
  openExternal?: (url: string) => Promise<void>;
};

const desktopApi = () => (window as typeof window & { electronAPI?: DesktopApi }).electronAPI;

const openUrl = (url: string) => {
  const api = desktopApi();
  if (api?.openExternal) api.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
};

const downloadPage = (status: ZhishuStatus) => `${status.site_origin}/apps/${status.app_key}`;

async function currentVersion(): Promise<string> {
  try {
    return (await desktopApi()?.getAppVersion?.()) || '';
  } catch {
    return '';
  }
}

/** 设置页顶部：接入状态和重新接入。 */
export function ZhishuAccountSection() {
  const t = useT(translations);
  const { status, reconnect } = useZhishuConnection();
  const [pending, setPending] = useState(false);
  return (
    <div data-testid="zhishu-account-section">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-foreground-primary mb-3 flex items-center">
        <PlugZap size={20} />
        <span className="ml-2">{t('accountTitle')}</span>
      </h2>
      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-border-primary dark:bg-background-secondary sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="font-medium text-green-700 dark:text-green-400">
            {t('connectedAs', { name: status?.user_name || '' })}
          </div>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-foreground-tertiary">{t('accountDesc')}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0 whitespace-nowrap"
          loading={pending}
          onClick={async () => {
            setPending(true);
            try {
              await reconnect();
            } finally {
              setPending(false);
            }
          }}
        >
          {t('reconnect')}
        </Button>
      </div>
    </div>
  );
}

/** 设置页底部：版本、从网站检查更新、开源署名。 */
export function ZhishuAbout() {
  const t = useT(translations);
  const { status } = useZhishuConnection();
  const [version, setVersion] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ latest: string; error: boolean } | null>(null);

  useEffect(() => { currentVersion().then(setVersion); }, []);

  const check = async () => {
    if (!status) return;
    setChecking(true);
    const latest = await getLatestAppVersion(status);
    setResult({ latest, error: !latest });
    setChecking(false);
  };

  const hasUpdate = !!result?.latest && !!version && result.latest !== version;
  return (
    <div className="pt-4 border-t border-gray-200 dark:border-border-primary">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-foreground-primary mb-3 flex items-center">
        <Info size={20} />
        <span className="ml-2">{t('aboutTitle')}</span>
      </h2>
      <div className="flex flex-col gap-3 text-sm text-gray-600 dark:text-foreground-tertiary sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div>{t('version')}: {version || '-'}</div>
          <div>{t('attribution')}</div>
          <div className="flex gap-3">
            <button type="button" onClick={() => openUrl(SOURCE_URL)} className="text-banana-700 dark:text-banana hover:underline">
              {t('source')}
            </button>
            <button type="button" onClick={() => openUrl(UPSTREAM_URL)} className="text-banana-700 dark:text-banana hover:underline">
              {t('upstream')}
            </button>
          </div>
          {result && (
            <div className={hasUpdate ? 'text-orange-600 dark:text-orange-400' : result.error ? 'text-red-600 dark:text-red-400' : ''}>
              {result.error ? t('checkFailed') : hasUpdate ? t('newVersion', { version: result.latest }) : t('upToDate')}
              {hasUpdate && status && (
                <button type="button" onClick={() => openUrl(downloadPage(status))} className="ml-2 inline-flex items-center gap-0.5 font-medium hover:underline">
                  {t('download')}
                  <ArrowUpRight size={14} />
                </button>
              )}
            </div>
          )}
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCw size={16} className={checking ? 'animate-spin' : ''} />}
          onClick={check}
          loading={checking}
        >
          {checking ? t('checking') : t('checkUpdate')}
        </Button>
      </div>
    </div>
  );
}

/** 启动后到网站查一次版本，有新版在右下角提示去网站下载。 */
export function SiteUpdateNotice() {
  const t = useT(translations);
  const { status } = useZhishuConnection();
  const [latest, setLatest] = useState('');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!status) return;
    let disposed = false;
    (async () => {
      const [mine, newest] = await Promise.all([currentVersion(), getLatestAppVersion(status)]);
      if (!disposed && mine && newest && mine !== newest) setLatest(newest);
    })();
    return () => { disposed = true; };
  }, [status]);

  if (!status || !latest || dismissed) return null;
  return (
    <div className="fixed bottom-5 right-5 z-[100] w-80 rounded-xl border border-gray-200 bg-white p-4 shadow-xl dark:border-border-primary dark:bg-background-elevated">
      <button type="button" aria-label={t('later')} onClick={() => setDismissed(true)} className="absolute right-2 top-2 text-gray-400 hover:text-gray-600">
        <X size={16} />
      </button>
      <p className="font-medium text-gray-900 dark:text-foreground-primary">{t('newVersion', { version: latest })}</p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => openUrl(downloadPage(status))}>{t('download')}</Button>
        <Button size="sm" variant="secondary" onClick={() => setDismissed(true)}>{t('later')}</Button>
      </div>
    </div>
  );
}
