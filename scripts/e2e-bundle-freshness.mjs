function assertE2eBundleFresh(productionInfo, e2eInfo) {
  const productionBytes = Number(productionInfo?.size);
  const e2eBytes = Number(e2eInfo?.size);
  if (!(productionBytes > 0) || !(e2eBytes > 0)) {
    throw new Error("Playwright bundles are missing or empty. Run npm run build:web first.");
  }
  const productionModifiedAt = Number(productionInfo?.mtimeMs);
  const e2eModifiedAt = Number(e2eInfo?.mtimeMs);
  if (Number.isFinite(productionModifiedAt)
    && Number.isFinite(e2eModifiedAt)
    && e2eModifiedAt + 5 < productionModifiedAt) {
    throw new Error("The Playwright diagnostic bundle is stale. Run npm run build:web first.");
  }
  return true;
}

export { assertE2eBundleFresh };
