import { afterEach, describe, expect, it } from 'vitest';
import { resolveEmbeddingConfig } from '../../src/core/embeddings/config.js';

const OLD_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe('resolveEmbeddingConfig', () => {
  it('applies env overrides for local resource controls', () => {
    process.env.MYGITNEXUS_EMBEDDING_THREADS = '3';
    process.env.MYGITNEXUS_EMBEDDING_BATCH_SIZE = '7';
    process.env.MYGITNEXUS_EMBEDDING_SUB_BATCH_SIZE = '5';
    process.env.MYGITNEXUS_EMBEDDING_DEVICE = 'cpu';

    const config = resolveEmbeddingConfig();

    expect(config.threads).toBe(3);
    expect(config.batchSize).toBe(7);
    expect(config.subBatchSize).toBe(5);
    expect(config.device).toBe('cpu');
  });

  it('rejects invalid numeric env values', () => {
    process.env.MYGITNEXUS_EMBEDDING_THREADS = '0';

    expect(() => resolveEmbeddingConfig()).toThrow('MYGITNEXUS_EMBEDDING_THREADS');
  });
});
