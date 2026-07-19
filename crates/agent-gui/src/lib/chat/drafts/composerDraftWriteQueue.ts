export class ComposerDraftWriteQueue {
  private readonly chains = new Map<string, Promise<void>>();

  enqueue(conversationId: string, operation: () => Promise<void>): Promise<void> {
    const key = conversationId.trim();
    if (!key) return Promise.resolve();

    const previous = this.chains.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.chains.set(key, next);
    void next.then(
      () => this.removeIfCurrent(key, next),
      () => this.removeIfCurrent(key, next),
    );
    return next;
  }

  async flush(conversationId?: string): Promise<void> {
    const key = conversationId?.trim();
    if (key) {
      await this.chains.get(key)?.catch(() => undefined);
      return;
    }
    await Promise.all(Array.from(this.chains.values(), (chain) => chain.catch(() => undefined)));
  }

  private removeIfCurrent(key: string, chain: Promise<void>) {
    if (this.chains.get(key) === chain) this.chains.delete(key);
  }
}
