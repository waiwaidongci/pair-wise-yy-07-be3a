import type { DiagramDocument } from '../types/diagram';
import { clonePlain, normalizeDocument } from './revision';

/**
 * 崩溃安全的本机草稿存储：
 *   STORAGE_KEY          主稿（编辑器唯一读取入口）
 *   STORAGE_KEY:stable   最后一次写入前的稳定版本
 *   STORAGE_KEY:staging  写入暂存区（主稿被覆盖前已校验可读）
 *
 * 写入顺序：稳定版先入备份 → 新稿进暂存并回读校验 → 覆盖主稿并回读校验 → 清暂存。
 * 任一步崩溃/抛错，下次启动按 主稿 → 稳定备份 → 暂存区 的顺序恢复。
 */
export const STORAGE_KEY = 'pair-wise-yy-07-diagram';
const STABLE_BACKUP_KEY = `${STORAGE_KEY}:stable`;
const STAGING_KEY = `${STORAGE_KEY}:staging`;

function rawGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function rawSet(key: string, value: string): void {
  localStorage.setItem(key, value);
}

function rawRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 隐私模式下可能拒绝写入；读取侧已能容忍残留暂存。
  }
}

function parseDocument(raw: string | null): DiagramDocument | null {
  if (!raw) return null;
  try {
    return normalizeDocument(JSON.parse(raw));
  } catch {
    return null;
  }
}

export interface LoadResult {
  document: DiagramDocument | null;
  recoveredFrom: 'main' | 'stable' | 'staging' | null;
  /** 主稿损坏、成功从备份恢复并完成一次自愈写入。 */
  selfHealed: boolean;
}

/** 启动/崩溃后加载：主稿损坏时从最后稳定版本恢复，再尝试暂存区。 */
export function loadStableDocument(): LoadResult {
  const main = parseDocument(rawGet(STORAGE_KEY));
  if (main) {
    // 上次写入若在清暂存前崩溃，暂存区可能残留；主稿有效即清理。
    rawRemove(STAGING_KEY);
    return { document: main, recoveredFrom: 'main', selfHealed: false };
  }

  const stable = parseDocument(rawGet(STABLE_BACKUP_KEY));
  if (stable) {
    try {
      rawSet(STORAGE_KEY, JSON.stringify(stable));
      rawRemove(STAGING_KEY);
      return { document: clonePlain(stable), recoveredFrom: 'stable', selfHealed: true };
    } catch {
      return { document: clonePlain(stable), recoveredFrom: 'stable', selfHealed: false };
    }
  }

  const staging = parseDocument(rawGet(STAGING_KEY));
  if (staging) {
    try {
      rawSet(STORAGE_KEY, JSON.stringify(staging));
      rawRemove(STAGING_KEY);
      return { document: clonePlain(staging), recoveredFrom: 'staging', selfHealed: true };
    } catch {
      return { document: clonePlain(staging), recoveredFrom: 'staging', selfHealed: false };
    }
  }

  return { document: null, recoveredFrom: null, selfHealed: false };
}

/**
 * 带备份的原子化写入。失败时自动回滚主稿到稳定版本并抛出，
 * 由调用方重试一次；重试仍失败则保留稳定版本不动。
 */
export function writeDocumentCrashSafe(document: DiagramDocument): void {
  const serialized = JSON.stringify(document);
  const previousRaw = rawGet(STORAGE_KEY);
  const previousValid = parseDocument(previousRaw);

  try {
    // 1. 旧主稿先成为稳定备份。
    if (previousValid) rawSet(STABLE_BACKUP_KEY, JSON.stringify(previousValid));
    // 2. 新稿写入暂存区并立即回读校验。
    rawSet(STAGING_KEY, serialized);
    const staged = parseDocument(rawGet(STAGING_KEY));
    if (!staged) throw new Error('暂存草稿回读校验失败');
    // 3. 覆盖主稿并回读校验。
    rawSet(STORAGE_KEY, serialized);
    const committed = parseDocument(rawGet(STORAGE_KEY));
    if (!committed) throw new Error('主稿回读校验失败');
    // 4. 提交成功，清理暂存。
    rawRemove(STAGING_KEY);
  } catch (error) {
    // 回滚到最后稳定版本，保证下次读取一定可用。
    if (previousValid) {
      try {
        rawSet(STORAGE_KEY, JSON.stringify(previousValid));
        rawRemove(STAGING_KEY);
      } catch {
        // 回滚也失败时稳定备份仍在，loadStableDocument 会兜住。
      }
    }
    throw error instanceof Error ? error : new Error('本机草稿写入失败');
  }
}
