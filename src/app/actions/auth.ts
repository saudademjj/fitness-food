'use server';

import {redirect} from 'next/navigation';
import {
  clearSessionCookie,
  createMagicLink,
  deleteCurrentSession,
  getViewer,
  isEmailAuthConfigured,
} from '@/lib/auth';
import {sendMail} from '@/lib/smtp';

export async function getViewerAction() {
  const viewer = await getViewer();
  return {
    viewer,
    authConfigured: isEmailAuthConfigured(),
  };
}

export async function requestMagicLinkAction(email: string): Promise<{ok: true}> {
  if (!isEmailAuthConfigured()) {
    throw new Error('邮箱登录尚未配置 SMTP，请先补齐服务端环境变量。');
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw new Error('请输入有效的邮箱地址。');
  }

  const {magicLink} = await createMagicLink(normalizedEmail);
  await sendMail({
    to: normalizedEmail,
    subject: '你的 Fitness Food 登录链接',
    text: `点击这个链接登录 Fitness Food（15 分钟内有效）：\n${magicLink}\n\n如果这不是你的操作，请忽略这封邮件。`,
  });

  return {ok: true};
}

export async function logoutAction(): Promise<void> {
  await deleteCurrentSession();
  await clearSessionCookie();
}

export async function redirectAfterLogout(): Promise<never> {
  await logoutAction();
  redirect('/');
}
