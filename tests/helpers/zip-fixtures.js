export function centralDirectoryOffset(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .getUint32(bytes.byteLength - 22 + 16, true);
}

export async function mutateZip(blob, mutate) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  mutate(bytes, new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return new Blob([bytes], { type: 'application/zip' });
}

export const truncateZip = async (blob, bytesToRemove = 1) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return new Blob([bytes.subarray(0, Math.max(0, bytes.length - bytesToRemove))], {
    type: 'application/zip',
  });
};
