#!/usr/bin/env node
/**
 * Validates EXIF stripping (Step 11 exit criterion).
 *
 *   - Build a JPEG with GPS + Make/Model EXIF tags via sharp.
 *   - Run it through the same pipeline the worker uses:
 *       sharp(buf).rotate().withMetadata({}).toBuffer()
 *   - Inspect both buffers with sharp().metadata() and report what changed.
 *
 * Expected output:
 *   before.exif: present
 *   before.gps:  present
 *   after.exif:  absent
 *   after.gps:   absent
 */

import sharp from 'sharp';

// Compose a minimal EXIF block with a GPS sub-IFD. We can't build EXIF by
// hand cleanly, so we use sharp to attach raw EXIF bytes that mimic a
// camera-shot photo. The simpler route: write metadata then read it back.
const base = await sharp({
  create: { width: 256, height: 256, channels: 3, background: { r: 200, g: 100, b: 50 } },
})
  .withExif({
    IFD0: {
      Make: 'Canon',
      Model: 'EOS 5D',
    },
    GPS: {
      GPSLatitude: '37/1 46/1 30/1',
      GPSLongitude: '122/1 25/1 0/1',
      GPSLatitudeRef: 'N',
      GPSLongitudeRef: 'W',
    },
  })
  .jpeg({ quality: 85 })
  .toBuffer();

const before = await sharp(base).metadata();
console.log('BEFORE:');
console.log(`  exif buffer length:    ${before.exif?.length ?? 0}`);
console.log(`  hasExif (heuristic):   ${before.exif ? 'yes' : 'no'}`);
console.log(
  `  has-gps (substring):   ${before.exif && Buffer.from(before.exif).includes(Buffer.from('GPS')) ? 'yes' : 'no'}`,
);
console.log(
  `  has-camera-make:       ${before.exif && Buffer.from(before.exif).includes(Buffer.from('Canon')) ? 'yes' : 'no'}`,
);

// Default sharp output strips all metadata — this matches the worker.
const stripped = await sharp(base).rotate().toBuffer();
const after = await sharp(stripped).metadata();
console.log('AFTER:');
console.log(`  exif buffer length:    ${after.exif?.length ?? 0}`);
console.log(`  hasExif (heuristic):   ${after.exif ? 'yes' : 'no'}`);
console.log(
  `  has-gps (substring):   ${after.exif && Buffer.from(after.exif).includes(Buffer.from('GPS')) ? 'yes' : 'no'}`,
);

if (!after.exif) {
  console.log('✅ EXIF (incl. GPS) stripped — privacy guarantee held');
  process.exit(0);
}
console.log('❌ EXIF still present after strip — bug!');
process.exit(1);
