'use strict';

const maxPngBytes = 5 * 1024 * 1024;
const iconSize = 64;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

function isPngIcon(value) {
  return typeof value === 'string' && value.length <= 32_768
    && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]+={0,2}$/.test(value);
}

async function readPngIcon(file) {
  if (file.size > maxPngBytes) throw new Error('5MB 이하의 PNG 파일을 선택해 주세요.');

  const header = await file.slice(0, 24).arrayBuffer();
  const bytes = new Uint8Array(header);
  const png = new DataView(header);
  if (bytes.length !== 24 || !pngSignature.every((byte, index) => bytes[index] === byte)
      || png.getUint32(8) !== 13 || png.getUint32(12) !== 0x49484452) {
    throw new Error('PNG 이미지 파일을 선택해 주세요.');
  }

  const width = png.getUint32(16);
  const height = png.getUint32(20);
  if (!width || !height || width > 4096 || height > 4096) {
    throw new Error('가로와 세로가 각각 4,096픽셀 이하인 PNG를 선택해 주세요.');
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(new Blob([file], { type: 'image/png' }));
  } catch {
    throw new Error('PNG 이미지를 읽을 수 없어요. 다른 파일을 선택해 주세요.');
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = iconSize;
    canvas.height = iconSize;
    const context = canvas.getContext('2d');
    const scale = iconSize / Math.max(bitmap.width, bitmap.height);
    const resizedWidth = Math.max(1, Math.round(bitmap.width * scale));
    const resizedHeight = Math.max(1, Math.round(bitmap.height * scale));
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, (iconSize - resizedWidth) / 2, (iconSize - resizedHeight) / 2, resizedWidth, resizedHeight);
    return canvas.toDataURL('image/png');
  } finally {
    bitmap.close();
  }
}
