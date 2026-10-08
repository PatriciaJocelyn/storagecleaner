/**
 * StorageAudit Pro - storage_audit.js
 * Utilitas Audit dan Pembersih Penyimpanan Berbasis Web UI (Node.js Native)
 * 
 * Modul Native: http, fs, path, crypto, os, url (Tanpa npm install)
 * Port: 3000 (http://localhost:3000)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const url = require('url');

const PORT = process.env.PORT || 3000;
const DEFAULT_TARGET_DIR = './Bahan Latihan P12';
const GIANT_FILE_THRESHOLD_BYTES = 2 * 1024 * 1024; // 2 MB (2.048 KB)

// State audit di memori
let currentAuditState = {
  scannedPath: '',
  absolutePath: '',
  scanTime: null,
  scanDurationMs: 0,
  allFiles: [],
  giantFiles: [],
  duplicateGroups: [],
  tmpFiles: [],
  summary: {
    totalFiles: 0,
    totalSizeBytes: 0,
    totalSizeFormatted: '0 B',
    giantFilesCount: 0,
    giantFilesTotalBytes: 0,
    giantFilesTotalFormatted: '0 B',
    duplicateGroupsCount: 0,
    duplicateFilesCount: 0,
    duplicateWasteBytes: 0,
    duplicateWasteFormatted: '0 B',
    tmpFilesCount: 0,
    tmpFilesBytes: 0,
    tmpFilesFormatted: '0 B',
    potentialSavingsBytes: 0,
    potentialSavingsFormatted: '0 B'
  }
};

/**
 * Format byte menjadi string terbaca manusia (B, KB, MB, GB)
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Format ukuran dalam KB dan MB secara spesifik untuk File Raksasa
 */
function formatSizeDual(bytes) {
  const kb = (bytes / 1024).toFixed(1);
  const mb = (bytes / (1024 * 1024)).toFixed(2);
  return `${mb} MB (${Number(kb).toLocaleString('id-ID')} KB)`;
}

/**
 * Hitung SHA-256 hash dari file menggunakan streaming
 */
function calculateFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', err => reject(err));
  });
}

/**
 * Rekursif membaca semua file dalam direktori dan subdirektorinya
 */
async function walkDirectory(dirPath, fileList = []) {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          // Lewati folder internal tertentu seperti .git jika ada di root
          if (entry.name === '.git') continue;
          await walkDirectory(fullPath, fileList);
        } else if (entry.isFile()) {
          fileList.push(fullPath);
        }
      } catch (innerErr) {
        console.warn(`[Peringatan] Gagal mengakses ${fullPath}:`, innerErr.message);
      }
    }
  } catch (err) {
    console.error(`[Error] Gagal membaca direktori ${dirPath}:`, err.message);
    throw err;
  }
  return fileList;
}

/**
 * Melakukan audit lengkap pada folder target
 */
async function performStorageAudit(targetFolderInput) {
  const startTime = Date.now();
  const resolvedTarget = path.resolve(process.cwd(), targetFolderInput.trim());

  if (!fs.existsSync(resolvedTarget)) {
    throw new Error(`Folder target tidak ditemukan: "${resolvedTarget}"`);
  }

  const stat = await fs.promises.stat(resolvedTarget);
  if (!stat.isDirectory()) {
    throw new Error(`Path yang dimasukkan bukan merupakan direktori: "${resolvedTarget}"`);
  }

  // 1. Kumpulkan semua file secara rekursif
  const filePaths = await walkDirectory(resolvedTarget, []);
  const allFiles = [];

  // 2. Ambil metadata dan hitung SHA-256 tiap file
  for (const filePath of filePaths) {
    try {
      const fileStat = await fs.promises.stat(filePath);
      const fileHash = await calculateFileHash(filePath);
      const fileName = path.basename(filePath);
      const relativePath = path.relative(resolvedTarget, filePath);
      const isTmp = fileName.toLowerCase().endsWith('.tmp');
      const isGiant = fileStat.size > GIANT_FILE_THRESHOLD_BYTES;

      allFiles.push({
        name: fileName,
        path: filePath,
        relativePath: relativePath.replace(/\\/g, '/'),
        sizeBytes: fileStat.size,
        sizeFormatted: formatBytes(fileStat.size),
        sizeDual: formatSizeDual(fileStat.size),
        hash: fileHash,
        mtime: fileStat.mtime.toISOString(),
        isTmp,
        isGiant
      });
    } catch (fileErr) {
      console.warn(`[Skip File] Gagal memproses ${filePath}:`, fileErr.message);
    }
  }

  // 3. Kelompokkan berdasarkan SHA-256 (Pendeteksian Duplikat)
  const hashMap = new Map();
  for (const file of allFiles) {
    if (!hashMap.has(file.hash)) {
      hashMap.set(file.hash, []);
    }
    hashMap.get(file.hash).push(file);
  }

  const duplicateGroups = [];
  let totalDuplicateWasteBytes = 0;
  let totalDuplicateFiles = 0;
  let groupIndex = 1;

  for (const [hashVal, files] of hashMap.entries()) {
    if (files.length >= 2) {
      // Urutkan file: yang tertua atau dengan nama tanpa '_copy' / '_BACKUP' menjadi yang asli
      files.sort((a, b) => {
        // Prioritas ke file yang tidak memiliki suffix duplikat umum
        const aDup = /(backup|copy|salinan|rev|v2|fix)/i.test(a.name);
        const bDup = /(backup|copy|salinan|rev|v2|fix)/i.test(b.name);
        if (aDup !== bDup) return aDup ? 1 : -1;
        return new Date(a.mtime) - new Date(b.mtime);
      });

      // Tandai file asli dan duplikat
      const enrichedFiles = files.map((f, idx) => ({
        ...f,
        isOriginal: idx === 0,
        isDuplicateCopy: idx > 0
      }));

      const singleSize = enrichedFiles[0].sizeBytes;
      const wasteBytes = singleSize * (enrichedFiles.length - 1);
      totalDuplicateWasteBytes += wasteBytes;
      totalDuplicateFiles += (enrichedFiles.length - 1);

      duplicateGroups.push({
        groupId: `GRP-${String(groupIndex).padStart(2, '0')}`,
        hash: hashVal,
        fileCount: enrichedFiles.length,
        duplicateCount: enrichedFiles.length - 1,
        singleSizeBytes: singleSize,
        singleSizeFormatted: formatBytes(singleSize),
        wasteBytes: wasteBytes,
        wasteFormatted: formatBytes(wasteBytes),
        files: enrichedFiles
      });
      groupIndex++;
    }
  }

  // Urutkan grup duplikat berdasarkan ruang terbuang terbesar
  duplicateGroups.sort((a, b) => b.wasteBytes - a.wasteBytes);

  // 4. Filter File Raksasa (> 2 MB / 2.048 KB)
  const giantFiles = allFiles
    .filter(f => f.isGiant)
    .sort((a, b) => b.sizeBytes - a.sizeBytes);

  // 5. File Sampah (.tmp)
  const tmpFiles = allFiles.filter(f => f.isTmp);
  const tmpFilesBytes = tmpFiles.reduce((acc, f) => acc + f.sizeBytes, 0);

  // 6. Hitung Total Kapasitas dan Potensi Hemat
  const totalSizeBytes = allFiles.reduce((acc, f) => acc + f.sizeBytes, 0);

  // Hindari hitung ganda jika ada file .tmp yang juga merupakan salinan duplikat
  const duplicateCopyPaths = new Set();
  duplicateGroups.forEach(grp => {
    grp.files.forEach(f => {
      if (f.isDuplicateCopy) duplicateCopyPaths.add(f.path);
    });
  });

  let extraTmpBytes = 0;
  tmpFiles.forEach(f => {
    if (!duplicateCopyPaths.has(f.path)) {
      extraTmpBytes += f.sizeBytes;
    }
  });

  const potentialSavingsBytes = totalDuplicateWasteBytes + extraTmpBytes;

  const durationMs = Date.now() - startTime;

  currentAuditState = {
    scannedPath: targetFolderInput,
    absolutePath: resolvedTarget,
    scanTime: new Date().toISOString(),
    scanDurationMs: durationMs,
    allFiles,
    giantFiles,
    duplicateGroups,
    tmpFiles,
    summary: {
      totalFiles: allFiles.length,
      totalSizeBytes: totalSizeBytes,
      totalSizeFormatted: formatBytes(totalSizeBytes),
      giantFilesCount: giantFiles.length,
      giantFilesTotalBytes: giantFiles.reduce((acc, f) => acc + f.sizeBytes, 0),
      giantFilesTotalFormatted: formatBytes(giantFiles.reduce((acc, f) => acc + f.sizeBytes, 0)),
      duplicateGroupsCount: duplicateGroups.length,
      duplicateFilesCount: totalDuplicateFiles,
      duplicateWasteBytes: totalDuplicateWasteBytes,
      duplicateWasteFormatted: formatBytes(totalDuplicateWasteBytes),
      tmpFilesCount: tmpFiles.length,
      tmpFilesBytes: tmpFilesBytes,
      tmpFilesFormatted: formatBytes(tmpFilesBytes),
      potentialSavingsBytes: potentialSavingsBytes,
      potentialSavingsFormatted: formatBytes(potentialSavingsBytes)
    }
  };

  return currentAuditState;
}

/**
 * Melakukan pembersihan in-place langsung pada folder target
 */
async function cleanStorageInPlace(options = {}) {
  const { deleteDuplicates = true, deleteTmp = true } = options;
  const deletedFiles = [];
  const errors = [];
  let freedBytes = 0;

  // Pastikan ada state audit yang valid
  if (!currentAuditState.absolutePath) {
    throw new Error('Belum ada folder yang dipindai. Silakan pindai folder terlebih dahulu.');
  }

  // 1. Hapus salinan duplikat (pertahankan 1 file asli per kelompok)
  if (deleteDuplicates && currentAuditState.duplicateGroups.length > 0) {
    for (const group of currentAuditState.duplicateGroups) {
      for (const file of group.files) {
        if (file.isDuplicateCopy) {
          try {
            if (fs.existsSync(file.path)) {
              await fs.promises.unlink(file.path);
              deletedFiles.push({
                name: file.name,
                path: file.path,
                sizeBytes: file.sizeBytes,
                sizeFormatted: file.sizeFormatted,
                reason: `Salinan Duplikat (${group.groupId})`
              });
              freedBytes += file.sizeBytes;
            }
          } catch (err) {
            errors.push({ path: file.path, message: err.message });
          }
        }
      }
    }
  }

  // 2. Hapus file temporary (.tmp) jika masih ada
  if (deleteTmp && currentAuditState.tmpFiles.length > 0) {
    for (const file of currentAuditState.tmpFiles) {
      try {
        if (fs.existsSync(file.path)) {
          // Cek apakah sudah terhapus di langkah duplikat
          const alreadyDeleted = deletedFiles.some(d => d.path === file.path);
          if (!alreadyDeleted) {
            await fs.promises.unlink(file.path);
            deletedFiles.push({
              name: file.name,
              path: file.path,
              sizeBytes: file.sizeBytes,
              sizeFormatted: file.sizeFormatted,
              reason: 'File Sampah (.tmp)'
            });
            freedBytes += file.sizeBytes;
          }
        }
      } catch (err) {
        errors.push({ path: file.path, message: err.message });
      }
    }
  }

  // 3. Pindai ulang secara otomatis untuk memperbarui metrik storage
  const updatedAudit = await performStorageAudit(currentAuditState.scannedPath);

  return {
    success: true,
    deletedCount: deletedFiles.length,
    freedBytes: freedBytes,
    freedFormatted: formatBytes(freedBytes),
    deletedFiles: deletedFiles,
    errors: errors,
    updatedAudit: updatedAudit
  };
}

/**
 * Helper untuk menyajikan data latihan (re-seed) jika diperlukan
 */
function seedSampleData() {
  const baseDir = path.resolve(process.cwd(), 'Bahan Latihan P12');
  const dirs = [
    baseDir,
    path.join(baseDir, 'Dokumen'),
    path.join(baseDir, 'Dokumen', 'Backup'),
    path.join(baseDir, 'Media'),
    path.join(baseDir, 'Media', 'Videos'),
    path.join(baseDir, 'Proyek'),
    path.join(baseDir, 'Proyek', 'Arsip'),
    path.join(baseDir, 'Temp'),
    path.join(baseDir, 'Database'),
  ];

  dirs.forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  function createDeterministicBuffer(seed, sizeBytes) {
    const buf = Buffer.alloc(sizeBytes);
    const hash = crypto.createHash('sha256').update(seed).digest();
    for (let i = 0; i < sizeBytes; i++) {
      buf[i] = hash[i % hash.length] ^ (i & 0xff);
    }
    return buf;
  }

  // 5 Giant Duplicate Groups (> 2 MB)
  const giantDup = [
    { seed: 'g_1', size: Math.round(2.4 * 1024 * 1024), files: ['Dokumen/modul_pelatihan_cloud.pdf', 'Dokumen/Backup/modul_pelatihan_cloud_BACKUP.pdf'] },
    { seed: 'g_2', size: Math.round(3.2 * 1024 * 1024), files: ['Proyek/dataset_transaksi_2025.csv', 'Proyek/Arsip/dataset_transaksi_2025_salinan.csv'] },
    { seed: 'g_3', size: Math.round(2.8 * 1024 * 1024), files: ['Dokumen/presentasi_final_direksi.pptx', 'Dokumen/Backup/presentasi_final_direksi_v2.pptx'] },
    { seed: 'g_4', size: Math.round(4.5 * 1024 * 1024), files: ['Media/Videos/rekaman_workshop_part1.mp4', 'Media/rekaman_workshop_part1_copy.mp4'] },
    { seed: 'g_5', size: Math.round(3.6 * 1024 * 1024), files: ['Database/dump_database_staging.sql', 'Database/backup_dump_staging_old.sql'] },
  ];

  // 5 Unique Giant Files (> 2 MB)
  const uniqueGiant = [
    { seed: 'u_1', size: Math.round(5.1 * 1024 * 1024), file: 'Proyek/system_firmware_image.bin' },
    { seed: 'u_2', size: Math.round(4.2 * 1024 * 1024), file: 'Dokumen/Backup/arsip_dokumentasi_full.zip' },
    { seed: 'u_3', size: Math.round(3.8 * 1024 * 1024), file: 'Proyek/model_nlp_weights.dat' },
    { seed: 'u_4', size: Math.round(2.9 * 1024 * 1024), file: 'Media/raw_vector_graphic_assets.ai' },
    { seed: 'u_5', size: Math.round(6.5 * 1024 * 1024), file: 'Proyek/Arsip/virtual_disk_snapshot.vmdk' },
  ];

  // 15 Normal Duplicate Groups (< 2 MB)
  const normDup = [
    { seed: 'n_1', size: Math.round(1.2 * 1024 * 1024), files: ['Dokumen/laporan_keuangan_januari.xlsx', 'Dokumen/Backup/laporan_keuangan_januari_rev.xlsx'] },
    { seed: 'n_2', size: 850 * 1024, files: ['Dokumen/panduan_onboarding.pdf', 'Dokumen/panduan_onboarding_karyawan.pdf'] },
    { seed: 'n_3', size: 620 * 1024, files: ['Media/foto_profil_direktur.png', 'Media/foto_profil_direktur_web.png'] },
    { seed: 'n_4', size: 120 * 1024, files: ['Proyek/script_migrasi_data.py', 'Proyek/Arsip/script_migrasi_data_backup.py'] },
    { seed: 'n_5', size: Math.round(1.8 * 1024 * 1024), files: ['Media/desain_banner_promo.psd', 'Media/desain_banner_promo_copy.psd'] },
    { seed: 'n_6', size: 410 * 1024, files: ['Dokumen/daftar_peserta_pelatihan.csv', 'Dokumen/daftar_peserta_pelatihan_fix.csv'] },
    { seed: 'n_7', size: Math.round(1.5 * 1024 * 1024), files: ['Media/audio_jingle_perusahaan.wav', 'Media/audio_jingle_final.wav'] },
    { seed: 'n_8', size: 340 * 1024, files: ['Dokumen/kontrak_kerja_template.docx', 'Dokumen/Backup/kontrak_kerja_template_lama.docx'] },
    { seed: 'n_9', size: 950 * 1024, files: ['Proyek/arsip_log_server_juni.log', 'Proyek/Arsip/arsip_log_server_juni_archive.log'] },
    { seed: 'n_10', size: 280 * 1024, files: ['Media/infografis_arsitektur.svg', 'Dokumen/infografis_arsitektur_vector.svg'] },
    { seed: 'n_11', size: 750 * 1024, files: ['Database/skema_erd_database.png', 'Proyek/skema_erd_database_v1.png'] },
    { seed: 'n_12', size: 530 * 1024, files: ['Dokumen/jadwal_pelatihan_q4.xlsx', 'Dokumen/Backup/jadwal_pelatihan_q4_draft.xlsx'] },
    { seed: 'n_13', size: Math.round(1.1 * 1024 * 1024), files: ['Dokumen/sertifikat_kelulusan_master.pdf', 'Dokumen/Backup/sertifikat_kelulusan_master_copy.pdf'] },
    { seed: 'n_14', size: Math.round(1.7 * 1024 * 1024), files: ['Dokumen/katalog_produk_2026.pdf', 'Dokumen/katalog_produk_2026_cetak.pdf'] },
    { seed: 'n_15', size: Math.round(1.9 * 1024 * 1024), files: ['Proyek/source_code_bundle.zip', 'Proyek/Arsip/source_code_bundle_backup.zip'] },
  ];

  // Temporary files
  const tmps = [
    { file: 'Temp/cache_session_01.tmp', size: 450 * 1024 },
    { file: 'Temp/editor_autosave.tmp', size: 120 * 1024 },
    { file: 'Dokumen/draft_unsaved.tmp', size: 280 * 1024 },
    { file: 'Proyek/build_artifact.tmp', size: 600 * 1024 }
  ];

  // Normal unique files
  const uniques = [
    { file: 'README.txt', size: 4 * 1024 },
    { file: 'Dokumen/kebijakan_privasi.docx', size: 180 * 1024 },
    { file: 'Media/logo_icon.svg', size: 45 * 1024 }
  ];

  giantDup.forEach(g => {
    const buf = createDeterministicBuffer(g.seed, g.size);
    g.files.forEach(f => fs.writeFileSync(path.join(baseDir, f), buf));
  });

  uniqueGiant.forEach(u => {
    const buf = createDeterministicBuffer(u.seed, u.size);
    fs.writeFileSync(path.join(baseDir, u.file), buf);
  });

  normDup.forEach(n => {
    const buf = createDeterministicBuffer(n.seed, n.size);
    n.files.forEach(f => fs.writeFileSync(path.join(baseDir, f), buf));
  });

  tmps.forEach(t => {
    const buf = createDeterministicBuffer('tmp_' + t.file, t.size);
    fs.writeFileSync(path.join(baseDir, t.file), buf);
  });

  uniques.forEach(u => {
    const buf = createDeterministicBuffer('uniq_' + u.file, u.size);
    fs.writeFileSync(path.join(baseDir, u.file), buf);
  });
}

/**
 * Tampilan HTML / CSS / JS Dashboard (Web UI Responsif & Modern)
 */
function renderHtml() {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>StorageAudit Pro — Smart Storage Cleaner</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #090d16;
      --bg-card: rgba(18, 25, 38, 0.72);
      --bg-card-hover: rgba(26, 36, 56, 0.85);
      --border-color: rgba(255, 255, 255, 0.08);
      --border-focus: rgba(99, 102, 241, 0.5);
      
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      --text-sub: #64748b;
      
      --primary: #6366f1;
      --primary-hover: #4f46e5;
      --primary-glow: rgba(99, 102, 241, 0.35);
      
      --accent-cyan: #06b6d4;
      --accent-emerald: #10b981;
      --accent-amber: #f59e0b;
      --accent-rose: #f43f5e;
      --accent-purple: #a855f7;
      
      --font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg-dark);
      background-image: 
        radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.15) 0px, transparent 50%),
        radial-gradient(at 100% 0%, rgba(6, 182, 212, 0.12) 0px, transparent 50%),
        radial-gradient(at 50% 100%, rgba(168, 85, 247, 0.1) 0px, transparent 50%);
      background-attachment: fixed;
      color: var(--text-main);
      font-family: var(--font-sans);
      min-height: 100vh;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    /* Container */
    .app-container {
      max-width: 1320px;
      margin: 0 auto;
      padding: 24px 20px 80px 20px;
    }

    /* Header */
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 28px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border-color);
      flex-wrap: wrap;
      gap: 16px;
    }

    .brand-wrap {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .brand-logo {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: linear-gradient(135deg, #6366f1, #06b6d4);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 20px rgba(99, 102, 241, 0.4);
    }

    .brand-logo svg {
      width: 24px;
      height: 24px;
      fill: none;
      stroke: white;
      stroke-width: 2;
    }

    .brand-title h1 {
      font-size: 1.35rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      background: linear-gradient(to right, #ffffff, #cbd5e1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .brand-title p {
      font-size: 0.8rem;
      color: var(--text-muted);
      font-weight: 500;
    }

    .header-badges {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #34d399;
    }

    .status-badge .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: #10b981;
      box-shadow: 0 0 8px #10b981;
      animation: pulse 2s infinite;
    }

    .info-badge {
      padding: 6px 12px;
      border-radius: 9999px;
      font-size: 0.75rem;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border-color);
      color: var(--text-muted);
      font-family: var(--font-mono);
    }

    /* Control Panel */
    .control-panel {
      background: var(--bg-card);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--border-color);
      border-radius: 18px;
      padding: 22px;
      margin-bottom: 28px;
      box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
    }

    .control-label {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .scan-form {
      display: flex;
      gap: 12px;
      align-items: stretch;
      flex-wrap: wrap;
    }

    .input-wrapper {
      position: relative;
      flex: 1;
      min-width: 280px;
    }

    .input-icon {
      position: absolute;
      left: 14px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-sub);
      pointer-events: none;
    }

    .input-icon svg {
      width: 18px;
      height: 18px;
    }

    .folder-input {
      width: 100%;
      background: rgba(10, 15, 28, 0.8);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 13px 14px 13px 44px;
      color: var(--text-main);
      font-family: var(--font-mono);
      font-size: 0.95rem;
      transition: all 0.2s ease;
      outline: none;
    }

    .folder-input:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--primary-glow);
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 22px;
      border-radius: 12px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      border: none;
      outline: none;
      user-select: none;
      white-space: nowrap;
    }

    .btn-primary {
      background: linear-gradient(135deg, var(--primary), #4f46e5);
      color: white;
      box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35);
    }

    .btn-primary:hover:not(:disabled) {
      background: linear-gradient(135deg, #4f46e5, #4338ca);
      box-shadow: 0 6px 20px rgba(99, 102, 241, 0.5);
      transform: translateY(-1px);
    }

    .btn-clean {
      background: linear-gradient(135deg, #f43f5e, #e11d48);
      color: white;
      box-shadow: 0 4px 16px rgba(244, 63, 94, 0.35);
    }

    .btn-clean:hover:not(:disabled) {
      background: linear-gradient(135deg, #e11d48, #be123c);
      box-shadow: 0 6px 22px rgba(244, 63, 94, 0.5);
      transform: translateY(-1px);
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--border-color);
      color: var(--text-muted);
    }

    .btn-secondary:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.1);
      color: var(--text-main);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none !important;
      box-shadow: none !important;
    }

    .quick-chips {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      flex-wrap: wrap;
      align-items: center;
    }

    .chip-label {
      font-size: 0.75rem;
      color: var(--text-sub);
    }

    .chip {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border-color);
      color: var(--text-muted);
      padding: 4px 10px;
      border-radius: 8px;
      font-size: 0.75rem;
      cursor: pointer;
      font-family: var(--font-mono);
      transition: all 0.15s ease;
    }

    .chip:hover {
      background: rgba(99, 102, 241, 0.15);
      border-color: rgba(99, 102, 241, 0.4);
      color: #c7d2fe;
    }

    /* 4 Metric Cards */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 18px;
      margin-bottom: 28px;
    }

    @media (max-width: 1024px) {
      .metrics-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    @media (max-width: 600px) {
      .metrics-grid {
        grid-template-columns: 1fr;
      }
    }

    .metric-card {
      background: var(--bg-card);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--border-color);
      border-radius: 18px;
      padding: 20px;
      position: relative;
      overflow: hidden;
      transition: transform 0.2s ease, border-color 0.2s ease;
    }

    .metric-card:hover {
      transform: translateY(-2px);
      border-color: rgba(255, 255, 255, 0.15);
    }

    .metric-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 3px;
    }

    .card-total::before { background: linear-gradient(90deg, #06b6d4, #3b82f6); }
    .card-capacity::before { background: linear-gradient(90deg, #a855f7, #6366f1); }
    .card-giant::before { background: linear-gradient(90deg, #f59e0b, #f97316); }
    .card-savings::before { background: linear-gradient(90deg, #10b981, #06b6d4); }

    .metric-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .metric-title {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .metric-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .card-total .metric-icon { background: rgba(6, 182, 212, 0.15); color: #22d3ee; }
    .card-capacity .metric-icon { background: rgba(168, 85, 247, 0.15); color: #c084fc; }
    .card-giant .metric-icon { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
    .card-savings .metric-icon { background: rgba(16, 185, 129, 0.15); color: #34d399; }

    .metric-icon svg {
      width: 18px;
      height: 18px;
    }

    .metric-value {
      font-size: 1.85rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      margin-bottom: 4px;
      color: #ffffff;
    }

    .metric-sub {
      font-size: 0.78rem;
      color: var(--text-sub);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .savings-highlight {
      color: #34d399;
      font-weight: 600;
    }

    /* Action Banner */
    .action-banner {
      background: linear-gradient(135deg, rgba(244, 63, 94, 0.12), rgba(99, 102, 241, 0.12));
      border: 1px solid rgba(244, 63, 94, 0.25);
      border-radius: 18px;
      padding: 18px 24px;
      margin-bottom: 28px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }

    .action-text h3 {
      font-size: 1.05rem;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 3px;
    }

    .action-text p {
      font-size: 0.85rem;
      color: var(--text-muted);
    }

    /* Tabs Navigation */
    .tabs-nav {
      display: flex;
      gap: 8px;
      margin-bottom: 20px;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 10px;
      overflow-x: auto;
    }

    .tab-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 0.9rem;
      font-weight: 600;
      padding: 8px 16px;
      border-radius: 10px;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
    }

    .tab-btn:hover {
      color: var(--text-main);
      background: rgba(255, 255, 255, 0.04);
    }

    .tab-btn.active {
      color: #ffffff;
      background: rgba(99, 102, 241, 0.18);
      border: 1px solid rgba(99, 102, 241, 0.3);
    }

    .tab-badge {
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 0.72rem;
      font-weight: 700;
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-muted);
    }

    .tab-btn.active .tab-badge {
      background: var(--primary);
      color: white;
    }

    /* Content Card */
    .content-card {
      background: var(--bg-card);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--border-color);
      border-radius: 18px;
      padding: 24px;
      box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
    }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      flex-wrap: wrap;
      gap: 12px;
    }

    .section-header h2 {
      font-size: 1.15rem;
      font-weight: 700;
      color: #ffffff;
    }

    .section-subtitle {
      font-size: 0.8rem;
      color: var(--text-sub);
      margin-top: 2px;
    }

    /* Accordion for Duplicate Groups */
    .accordion-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .accordion-item {
      border: 1px solid var(--border-color);
      border-radius: 14px;
      background: rgba(14, 20, 32, 0.6);
      overflow: hidden;
      transition: all 0.2s ease;
    }

    .accordion-item:hover {
      border-color: rgba(255, 255, 255, 0.14);
    }

    .accordion-header {
      padding: 16px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
      background: transparent;
      gap: 14px;
      flex-wrap: wrap;
    }

    .grp-left {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .grp-tag {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      font-weight: 700;
      padding: 4px 8px;
      border-radius: 6px;
      background: rgba(99, 102, 241, 0.2);
      border: 1px solid rgba(99, 102, 241, 0.4);
      color: #a5b4fc;
    }

    .grp-hash {
      font-family: var(--font-mono);
      font-size: 0.78rem;
      color: var(--text-muted);
      background: rgba(0, 0, 0, 0.3);
      padding: 4px 8px;
      border-radius: 6px;
    }

    .grp-right {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .grp-stat {
      font-size: 0.82rem;
      color: var(--text-muted);
    }

    .grp-waste {
      font-size: 0.82rem;
      color: #f43f5e;
      font-weight: 600;
    }

    .chevron-icon {
      transition: transform 0.25s ease;
      width: 18px;
      height: 18px;
      color: var(--text-sub);
    }

    .accordion-item.open .chevron-icon {
      transform: rotate(180deg);
      color: var(--primary);
    }

    .accordion-body {
      display: none;
      padding: 0 20px 18px 20px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
    }

    .accordion-item.open .accordion-body {
      display: block;
    }

    .file-item-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 14px;
      margin-top: 10px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.04);
      gap: 12px;
      flex-wrap: wrap;
    }

    .file-item-row.is-original {
      border-left: 3px solid #10b981;
      background: rgba(16, 185, 129, 0.04);
    }

    .file-item-row.is-duplicate {
      border-left: 3px solid #f43f5e;
      background: rgba(244, 63, 94, 0.04);
    }

    .file-info {
      display: flex;
      flex-direction: column;
      gap: 3px;
      flex: 1;
      min-width: 200px;
    }

    .file-name-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .file-name {
      font-weight: 600;
      font-size: 0.88rem;
      color: #ffffff;
      word-break: break-all;
    }

    .badge-original {
      font-size: 0.68rem;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 6px;
      background: rgba(16, 185, 129, 0.18);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.35);
    }

    .badge-dup {
      font-size: 0.68rem;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 6px;
      background: rgba(244, 63, 94, 0.18);
      color: #fb7185;
      border: 1px solid rgba(244, 63, 94, 0.35);
    }

    .file-path {
      font-family: var(--font-mono);
      font-size: 0.72rem;
      color: var(--text-sub);
      word-break: break-all;
    }

    .file-meta {
      font-size: 0.78rem;
      color: var(--text-muted);
      white-space: nowrap;
      text-align: right;
    }

    /* Table for Giant Files and All Files */
    .table-responsive {
      overflow-x: auto;
      border-radius: 12px;
      border: 1px solid var(--border-color);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.85rem;
    }

    thead {
      background: rgba(10, 15, 26, 0.8);
      border-bottom: 1px solid var(--border-color);
    }

    th {
      padding: 14px 16px;
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    td {
      padding: 13px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      color: var(--text-muted);
      vertical-align: middle;
    }

    tbody tr:hover {
      background: rgba(255, 255, 255, 0.02);
    }

    tbody tr:last-child td {
      border-bottom: none;
    }

    .size-giant-badge {
      font-family: var(--font-mono);
      font-weight: 600;
      color: #fbbf24;
      background: rgba(245, 158, 11, 0.12);
      padding: 4px 8px;
      border-radius: 6px;
      display: inline-block;
    }

    .hash-badge {
      font-family: var(--font-mono);
      font-size: 0.74rem;
      background: rgba(0, 0, 0, 0.3);
      padding: 3px 6px;
      border-radius: 4px;
      color: #94a3b8;
    }

    /* Modal */
    .modal-backdrop {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(4, 7, 14, 0.8);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 999;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }

    .modal-backdrop.active {
      display: flex;
      animation: fadeIn 0.2s ease-out;
    }

    .modal-box {
      background: #0f1626;
      border: 1px solid rgba(244, 63, 94, 0.3);
      border-radius: 20px;
      width: 100%;
      max-width: 540px;
      box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.8), 0 0 40px rgba(244, 63, 94, 0.15);
      overflow: hidden;
      transform: scale(0.95);
      animation: zoomIn 0.2s ease-out forwards;
    }

    .modal-header {
      padding: 24px 24px 16px 24px;
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .modal-icon-danger {
      width: 48px;
      height: 48px;
      border-radius: 14px;
      background: rgba(244, 63, 94, 0.15);
      color: #fb7185;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .modal-icon-danger svg {
      width: 24px;
      height: 24px;
    }

    .modal-title h3 {
      font-size: 1.15rem;
      font-weight: 700;
      color: #ffffff;
    }

    .modal-title p {
      font-size: 0.82rem;
      color: var(--text-sub);
    }

    .modal-body {
      padding: 0 24px 24px 24px;
    }

    .confirm-summary-box {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border-color);
      border-radius: 14px;
      padding: 16px;
      margin-bottom: 20px;
    }

    .confirm-item {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 0.85rem;
    }

    .confirm-item:last-child {
      margin-bottom: 0;
    }

    .confirm-label {
      color: var(--text-muted);
    }

    .confirm-value {
      font-weight: 600;
      color: #ffffff;
    }

    .confirm-value.danger {
      color: #fb7185;
    }

    .confirm-value.emerald {
      color: #34d399;
    }

    .security-note {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 12px 14px;
      border-radius: 10px;
      background: rgba(16, 185, 129, 0.08);
      border: 1px solid rgba(16, 185, 129, 0.2);
      font-size: 0.8rem;
      color: #6ee7b7;
      margin-bottom: 20px;
    }

    .security-note svg {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .modal-footer {
      padding: 16px 24px;
      background: rgba(0, 0, 0, 0.25);
      border-top: 1px solid var(--border-color);
      display: flex;
      justify-content: flex-end;
      gap: 12px;
    }

    /* Toast Notification */
    .toast-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
    }

    .toast {
      pointer-events: auto;
      background: #111827;
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 14px 18px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 0.85rem;
      color: #ffffff;
      animation: slideInRight 0.25s ease-out forwards;
    }

    .toast.success { border-color: rgba(16, 185, 129, 0.4); }
    .toast.error { border-color: rgba(244, 63, 94, 0.4); }

    /* Empty state */
    .empty-state {
      text-align: center;
      padding: 48px 20px;
      color: var(--text-sub);
    }

    .empty-state svg {
      width: 48px;
      height: 48px;
      margin-bottom: 12px;
      opacity: 0.4;
    }

    /* Animations */
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes zoomIn { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    @keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    @keyframes spin { 100% { transform: rotate(360deg); } }

    .spinning {
      animation: spin 1s linear infinite;
    }
  </style>
</head>
<body>
  <div class="app-container">
    
    <!-- Top Header -->
    <header>
      <div class="brand-wrap">
        <div class="brand-logo">
          <svg viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/>
          </svg>
        </div>
        <div class="brand-title">
          <h1>StorageAudit Pro</h1>
          <p>Recursive SHA-256 Storage Inspector & In-Place Cleaner</p>
        </div>
      </div>
      
      <div class="header-badges">
        <span class="status-badge"><span class="dot"></span> Sistem Aktif</span>
        <span class="info-badge">Node.js Native (HTTP/FS/Crypto)</span>
        <span class="info-badge">Port: 3000</span>
      </div>
    </header>

    <!-- Scan Control Panel -->
    <section class="control-panel">
      <div class="control-label">
        <span>Target Folder Penyimpanan (Dinamis)</span>
        <span id="scanStatusText">Siap memindai</span>
      </div>
      
      <form class="scan-form" id="scanForm" onsubmit="event.preventDefault(); startScan();">
        <div class="input-wrapper">
          <span class="input-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
            </svg>
          </span>
          <input 
            type="text" 
            id="targetPathInput" 
            class="folder-input" 
            value="./Bahan Latihan P12" 
            placeholder="Ketik path folder, misal: ./Bahan Latihan P12 atau C:/..." 
            autocomplete="off"
            spellcheck="false"
            required
          />
        </div>
        
        <button type="submit" class="btn btn-primary" id="btnScan">
          <svg id="scanIcon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <span id="btnScanText">Pindai Folder</span>
        </button>

        <button type="button" class="btn btn-secondary" onclick="seedSampleFiles()" title="Buat ulang sampel data jika diperlukan">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
          <span>Reset Sampel Latihan</span>
        </button>
      </form>

      <div class="quick-chips">
        <span class="chip-label">Shortcut Cepat:</span>
        <button class="chip" onclick="setTargetPath('./Bahan Latihan P12')">./Bahan Latihan P12</button>
        <button class="chip" onclick="setTargetPath('./Bahan Latihan P12/Dokumen')">./Bahan Latihan P12/Dokumen</button>
        <button class="chip" onclick="setTargetPath('./Bahan Latihan P12/Media')">./Bahan Latihan P12/Media</button>
        <button class="chip" onclick="setTargetPath('./')">./ (Root Folder)</button>
      </div>
    </section>

    <!-- 4 Metric Cards -->
    <div class="metrics-grid">
      <!-- Card 1: Total File -->
      <div class="metric-card card-total">
        <div class="metric-top">
          <span class="metric-title">Total File</span>
          <div class="metric-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
          </div>
        </div>
        <div class="metric-value" id="cardTotalFiles">0</div>
        <div class="metric-sub">Termasuk subfolder rekursif</div>
      </div>

      <!-- Card 2: Total Kapasitas -->
      <div class="metric-card card-capacity">
        <div class="metric-top">
          <span class="metric-title">Total Kapasitas</span>
          <div class="metric-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"/>
            </svg>
          </div>
        </div>
        <div class="metric-value" id="cardTotalCapacity">0 B</div>
        <div class="metric-sub" id="cardCapacitySub">Ukuran aktual di disk</div>
      </div>

      <!-- Card 3: File Raksasa -->
      <div class="metric-card card-giant">
        <div class="metric-top">
          <span class="metric-title">File Raksasa (> 2 MB)</span>
          <div class="metric-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/>
            </svg>
          </div>
        </div>
        <div class="metric-value" id="cardGiantFiles">0</div>
        <div class="metric-sub" id="cardGiantSub">Ambang batas 2.048 KB</div>
      </div>

      <!-- Card 4: Potensi Hemat -->
      <div class="metric-card card-savings">
        <div class="metric-top">
          <span class="metric-title">Potensi Hemat</span>
          <div class="metric-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          </div>
        </div>
        <div class="metric-value savings-highlight" id="cardSavings">0 B</div>
        <div class="metric-sub" id="cardSavingsSub">Dari duplikat & file .tmp</div>
      </div>
    </div>

    <!-- Action Banner for Cleaning -->
    <div class="action-banner" id="actionBanner" style="display: none;">
      <div class="action-text">
        <h3>Pembersihan Storage Tersedia</h3>
        <p id="actionBannerText">Ditemukan file duplikat dan file sampah yang dapat dibersihkan secara aman in-place.</p>
      </div>
      <button class="btn btn-clean" id="btnOpenCleanModal" onclick="openCleanModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
        </svg>
        <span>Bersihkan Duplikat & Sampah</span>
      </button>
    </div>

    <!-- Tabs Navigation -->
    <div class="tabs-nav">
      <button class="tab-btn active" onclick="switchTab('tab-duplicates', this)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
        </svg>
        <span>Kelompok Duplikat</span>
        <span class="tab-badge" id="badgeTabDup">0</span>
      </button>
      <button class="tab-btn" onclick="switchTab('tab-giants', this)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/>
        </svg>
        <span>File Raksasa (> 2 MB)</span>
        <span class="tab-badge" id="badgeTabGiants">0</span>
      </button>
      <button class="tab-btn" onclick="switchTab('tab-tmp', this)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
        </svg>
        <span>File Sampah (.tmp)</span>
        <span class="tab-badge" id="badgeTabTmp">0</span>
      </button>
      <button class="tab-btn" onclick="switchTab('tab-all', this)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16"/>
        </svg>
        <span>Semua File (Metadata)</span>
        <span class="tab-badge" id="badgeTabAll">0</span>
      </button>
    </div>

    <!-- Main Content Container -->
    <main class="content-card">
      
      <!-- TAB 1: DUPLICATE GROUPS -->
      <section id="tab-duplicates" class="tab-content">
        <div class="section-header">
          <div>
            <h2>Kelompok File Duplikat (SHA-256 Identik)</h2>
            <p class="section-subtitle">File dengan hash konten persis sama dikelompokkan bersama. Sistem mempertahankan 1 file asli dan menandai salinan untuk dihapus.</p>
          </div>
          <div id="dupQuickSummary" class="info-badge" style="display:none;"></div>
        </div>

        <div id="duplicateListContainer" class="accordion-list">
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            <p>Silakan klik tombol "Pindai Folder" untuk memulai audit penyimpanan.</p>
          </div>
        </div>
      </section>

      <!-- TAB 2: GIANT FILES (> 2 MB) -->
      <section id="tab-giants" class="tab-content" style="display: none;">
        <div class="section-header">
          <div>
            <h2>Daftar File Raksasa (> 2 MB / 2.048 KB)</h2>
            <p class="section-subtitle">File berukuran besar yang paling banyak mengonsumsi ruang penyimpanan.</p>
          </div>
          <div id="giantsQuickSummary" class="info-badge" style="display:none;"></div>
        </div>

        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th style="width: 50px;">#</th>
                <th>Nama File</th>
                <th>Ukuran (MB & KB)</th>
                <th>Path Relatif</th>
                <th>Path Absolut</th>
                <th>Hash (SHA-256)</th>
              </tr>
            </thead>
            <tbody id="giantTableBody">
              <tr>
                <td colspan="6" style="text-align: center; padding: 30px;">Belum ada data. Silakan pindai folder.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- TAB 3: TMP FILES -->
      <section id="tab-tmp" class="tab-content" style="display: none;">
        <div class="section-header">
          <div>
            <h2>Daftar File Sampah (.tmp)</h2>
            <p class="section-subtitle">File sementara/temporary yang aman dihapus untuk memulihkan kapasitas.</p>
          </div>
        </div>

        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th style="width: 50px;">#</th>
                <th>Nama File</th>
                <th>Ukuran</th>
                <th>Lokasi</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="tmpTableBody">
              <tr>
                <td colspan="5" style="text-align: center; padding: 30px;">Belum ada data. Silakan pindai folder.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- TAB 4: ALL FILES -->
      <section id="tab-all" class="tab-content" style="display: none;">
        <div class="section-header">
          <div>
            <h2>Daftar Lengkap File di Memori</h2>
            <p class="section-subtitle">Semua file yang terdeteksi dari hasil pemindaian rekursif beserta metadata lengkap.</p>
          </div>
        </div>

        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th style="width: 50px;">#</th>
                <th>Nama File</th>
                <th>Ukuran</th>
                <th>Kategori</th>
                <th>Path Relatif</th>
                <th>Hash (SHA-256)</th>
              </tr>
            </thead>
            <tbody id="allFilesTableBody">
              <tr>
                <td colspan="6" style="text-align: center; padding: 30px;">Belum ada data. Silakan pindai folder.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

    </main>

  </div>

  <!-- Modal Konfirmasi Pembersihan In-Place -->
  <div class="modal-backdrop" id="cleanModal">
    <div class="modal-box">
      <div class="modal-header">
        <div class="modal-icon-danger">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
        </div>
        <div class="modal-title">
          <h3>Konfirmasi Pembersihan In-Place</h3>
          <p>Tindakan ini langsung mengeksekusi penghapusan di folder asal</p>
        </div>
      </div>

      <div class="modal-body">
        <div class="confirm-summary-box">
          <div class="confirm-item">
            <span class="confirm-label">Folder Target:</span>
            <span class="confirm-value" id="modalTargetFolder" style="font-family: var(--font-mono); font-size: 0.8rem;">-</span>
          </div>
          <div class="confirm-item">
            <span class="confirm-label">Salinan Duplikat yang akan dihapus:</span>
            <span class="confirm-value danger" id="modalDupCount">0 File</span>
          </div>
          <div class="confirm-item">
            <span class="confirm-label">File Sampah (.tmp) yang akan dihapus:</span>
            <span class="confirm-value danger" id="modalTmpCount">0 File</span>
          </div>
          <div class="confirm-item" style="border-top: 1px solid var(--border-color); padding-top: 8px; margin-top: 8px;">
            <span class="confirm-label">Total Ruang yang Dipulihkan:</span>
            <span class="confirm-value emerald" id="modalFreedSpace" style="font-size: 1.05rem;">0 B</span>
          </div>
        </div>

        <div class="security-note">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
          </svg>
          <div>
            <strong>Prinsip Keamanan Data:</strong> Tepat <strong>1 file asli</strong> per kelompok duplikat akan <strong>DIJAMIN TETAP AMAN & DIPERTAHANKAN</strong>. Hanya salinan kembar berlebih dan file .tmp yang dihapus.
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px; font-size: 0.85rem; color: var(--text-muted);">
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <input type="checkbox" id="chkDeleteDup" checked />
            Hapus salinan duplikat (pertahankan 1 file asli per kelompok)
          </label>
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <input type="checkbox" id="chkDeleteTmp" checked />
            Hapus file temporary (.tmp)
          </label>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeCleanModal()">Batalkan</button>
        <button class="btn btn-clean" id="btnConfirmClean" onclick="executeClean()">
          <span id="btnConfirmText">Ya, Bersihkan Sekarang</span>
        </button>
      </div>
    </div>
  </div>

  <!-- Toast Container -->
  <div class="toast-container" id="toastContainer"></div>

  <!-- Client-side Logic -->
  <script>
    let currentAuditData = null;

    function setTargetPath(pathVal) {
      document.getElementById('targetPathInput').value = pathVal;
      startScan();
    }

    function switchTab(tabId, btnElem) {
      document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
      document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
      
      const target = document.getElementById(tabId);
      if (target) target.style.display = 'block';
      if (btnElem) btnElem.classList.add('active');
    }

    function showToast(message, type = 'info') {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = 'toast ' + type;
      toast.innerHTML = \`
        <span>\${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
        <span>\${message}</span>
      \`;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }, 4000);
    }

    async function startScan() {
      const targetPath = document.getElementById('targetPathInput').value.trim();
      if (!targetPath) {
        showToast('Mohon masukkan path folder target!', 'error');
        return;
      }

      const btnScan = document.getElementById('btnScan');
      const btnScanText = document.getElementById('btnScanText');
      const scanIcon = document.getElementById('scanIcon');
      const statusText = document.getElementById('scanStatusText');

      btnScan.disabled = true;
      btnScanText.textContent = 'Memindai...';
      scanIcon.classList.add('spinning');
      statusText.textContent = 'Sedang membaca file & SHA-256...';

      try {
        const response = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetPath })
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.error || 'Gagal melakukan pemindaian folder.');
        }

        currentAuditData = result.audit;
        renderDashboard(currentAuditData);
        showToast(\`Pemindaian selesai dalam \${currentAuditData.scanDurationMs} ms. Terdeteksi \${currentAuditData.summary.totalFiles} file.\`, 'success');
        statusText.textContent = \`Selesai: \${currentAuditData.summary.totalFiles} file terdeteksi (\${currentAuditData.scanDurationMs} ms)\`;

      } catch (err) {
        console.error(err);
        showToast(err.message, 'error');
        statusText.textContent = 'Gagal memindai folder.';
      } finally {
        btnScan.disabled = false;
        btnScanText.textContent = 'Pindai Folder';
        scanIcon.classList.remove('spinning');
      }
    }

    function renderDashboard(data) {
      if (!data) return;

      const summary = data.summary;

      // 1. Update 4 Metric Cards
      document.getElementById('cardTotalFiles').textContent = summary.totalFiles.toLocaleString('id-ID');
      document.getElementById('cardTotalCapacity').textContent = summary.totalSizeFormatted;
      document.getElementById('cardCapacitySub').textContent = \`\${(summary.totalSizeBytes / 1024).toLocaleString('id-ID', {maximumFractionDigits:1})} KB terpakai\`;
      
      document.getElementById('cardGiantFiles').textContent = summary.giantFilesCount.toLocaleString('id-ID');
      document.getElementById('cardGiantSub').textContent = \`Total \${summary.giantFilesTotalFormatted}\`;
      
      document.getElementById('cardSavings').textContent = summary.potentialSavingsFormatted;
      const savingsPct = summary.totalSizeBytes > 0 ? ((summary.potentialSavingsBytes / summary.totalSizeBytes) * 100).toFixed(1) : 0;
      document.getElementById('cardSavingsSub').textContent = \`Potensi hemat ~\${savingsPct}% kapasitas\`;

      // 2. Action Banner
      const actionBanner = document.getElementById('actionBanner');
      if (summary.potentialSavingsBytes > 0) {
        actionBanner.style.display = 'flex';
        document.getElementById('actionBannerText').textContent = 
          \`Ditemukan \${summary.duplicateFilesCount} salinan duplikat dan \${summary.tmpFilesCount} file .tmp. Potensi membebaskan ruang hingga \${summary.potentialSavingsFormatted}.\`;
      } else {
        actionBanner.style.display = 'none';
      }

      // 3. Tab Badges
      document.getElementById('badgeTabDup').textContent = summary.duplicateGroupsCount;
      document.getElementById('badgeTabGiants').textContent = summary.giantFilesCount;
      document.getElementById('badgeTabTmp').textContent = summary.tmpFilesCount;
      document.getElementById('badgeTabAll').textContent = summary.totalFiles;

      // 4. Render Duplicate Accordion
      renderDuplicateGroups(data.duplicateGroups);

      // 5. Render Giant Files Table
      renderGiantFiles(data.giantFiles);

      // 6. Render Tmp Files Table
      renderTmpFiles(data.tmpFiles);

      // 7. Render All Files Table
      renderAllFiles(data.allFiles);
    }

    function renderDuplicateGroups(groups) {
      const container = document.getElementById('duplicateListContainer');
      const quickSummary = document.getElementById('dupQuickSummary');

      if (!groups || groups.length === 0) {
        quickSummary.style.display = 'none';
        container.innerHTML = \`
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
            </svg>
            <p><strong>Luar biasa! Tidak ditemukan file duplikat.</strong></p>
            <span style="font-size: 0.8rem; color: var(--text-sub);">Semua file di folder ini memiliki hash SHA-256 yang unik.</span>
          </div>
        \`;
        return;
      }

      quickSummary.style.display = 'inline-block';
      quickSummary.textContent = \`\${groups.length} Kelompok Duplikat Terdeteksi\`;

      let html = '';
      groups.forEach((grp, idx) => {
        const isOpen = idx < 3 ? 'open' : ''; // Buka 3 grup teratas secara default
        html += \`
          <div class="accordion-item \${isOpen}" id="accItem-\${grp.groupId}">
            <div class="accordion-header" onclick="toggleAccordion('accItem-\${grp.groupId}')">
              <div class="grp-left">
                <span class="grp-tag">\${grp.groupId}</span>
                <span class="grp-hash" title="Full SHA-256: \${grp.hash}">SHA: \${grp.hash.substring(0, 16)}...</span>
                <span class="info-badge" style="padding: 2px 8px;">\${grp.fileCount} File Identik</span>
              </div>
              <div class="grp-right">
                <span class="grp-stat">Ukuran: \${grp.singleSizeFormatted}</span>
                <span class="grp-waste">Terbuang: +\${grp.wasteFormatted}</span>
                <svg class="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
                </svg>
              </div>
            </div>
            <div class="accordion-body">
              \${grp.files.map(f => \`
                <div class="file-item-row \${f.isOriginal ? 'is-original' : 'is-duplicate'}">
                  <div class="file-info">
                    <div class="file-name-wrap">
                      <span class="file-name">\${escapeHtml(f.name)}</span>
                      \${f.isOriginal 
                        ? '<span class="badge-original">🛡️ ASLI (DIPERTAHANKAN)</span>' 
                        : '<span class="badge-dup">🗑️ DUPLIKAT (SIAP DIHAPUS)</span>'}
                    </div>
                    <span class="file-path">\${escapeHtml(f.path)}</span>
                  </div>
                  <div class="file-meta">
                    <div>\${f.sizeFormatted}</div>
                    <div style="font-size: 0.7rem; color: var(--text-sub);">\${new Date(f.mtime).toLocaleString('id-ID')}</div>
                  </div>
                </div>
              \`).join('')}
            </div>
          </div>
        \`;
      });

      container.innerHTML = html;
    }

    function toggleAccordion(itemId) {
      const item = document.getElementById(itemId);
      if (item) {
        item.classList.toggle('open');
      }
    }

    function renderGiantFiles(files) {
      const tbody = document.getElementById('giantTableBody');
      const quickSummary = document.getElementById('giantsQuickSummary');

      if (!files || files.length === 0) {
        quickSummary.style.display = 'none';
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 30px;">Tidak ada file yang melebihi ambang batas 2 MB (2.048 KB).</td></tr>';
        return;
      }

      quickSummary.style.display = 'inline-block';
      quickSummary.textContent = \`\${files.length} File Raksasa Terdeteksi\`;

      let html = '';
      files.forEach((f, idx) => {
        html += \`
          <tr>
            <td>\${idx + 1}</td>
            <td style="font-weight: 600; color: #ffffff;">\${escapeHtml(f.name)}</td>
            <td><span class="size-giant-badge">\${f.sizeDual}</span></td>
            <td style="font-family: var(--font-mono); font-size: 0.78rem;">\${escapeHtml(f.relativePath)}</td>
            <td style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-sub);" title="\${escapeHtml(f.path)}">\${escapeHtml(f.path)}</td>
            <td><span class="hash-badge" title="\${f.hash}">\${f.hash.substring(0, 12)}...</span></td>
          </tr>
        \`;
      });
      tbody.innerHTML = html;
    }

    function renderTmpFiles(files) {
      const tbody = document.getElementById('tmpTableBody');
      if (!files || files.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 30px;">Bersih! Tidak ada file sampah berformat .tmp.</td></tr>';
        return;
      }

      let html = '';
      files.forEach((f, idx) => {
        html += \`
          <tr>
            <td>\${idx + 1}</td>
            <td style="font-weight: 600; color: #ffffff;">\${escapeHtml(f.name)}</td>
            <td>\${f.sizeFormatted}</td>
            <td style="font-family: var(--font-mono); font-size: 0.78rem;">\${escapeHtml(f.relativePath)}</td>
            <td><span class="badge-dup">File Sementara (.tmp)</span></td>
          </tr>
        \`;
      });
      tbody.innerHTML = html;
    }

    function renderAllFiles(files) {
      const tbody = document.getElementById('allFilesTableBody');
      if (!files || files.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 30px;">Tidak ada file yang terdaftar.</td></tr>';
        return;
      }

      let html = '';
      files.forEach((f, idx) => {
        const categoryTag = f.isGiant 
          ? '<span class="badge-dup" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border-color: rgba(245, 158, 11, 0.3);">Raksasa (> 2MB)</span>'
          : f.isTmp 
            ? '<span class="badge-dup">File .tmp</span>'
            : '<span class="info-badge" style="padding: 2px 6px;">Standar</span>';

        html += \`
          <tr>
            <td>\${idx + 1}</td>
            <td style="font-weight: 500; color: #ffffff;">\${escapeHtml(f.name)}</td>
            <td style="font-family: var(--font-mono);">\${f.sizeFormatted}</td>
            <td>\${categoryTag}</td>
            <td style="font-family: var(--font-mono); font-size: 0.78rem;">\${escapeHtml(f.relativePath)}</td>
            <td><span class="hash-badge" title="\${f.hash}">\${f.hash.substring(0, 12)}...</span></td>
          </tr>
        \`;
      });
      tbody.innerHTML = html;
    }

    // Modal Handlers
    function openCleanModal() {
      if (!currentAuditData) return;
      
      const summary = currentAuditData.summary;
      document.getElementById('modalTargetFolder').textContent = currentAuditData.absolutePath;
      document.getElementById('modalDupCount').textContent = \`\${summary.duplicateFilesCount} File\`;
      document.getElementById('modalTmpCount').textContent = \`\${summary.tmpFilesCount} File\`;
      document.getElementById('modalFreedSpace').textContent = summary.potentialSavingsFormatted;

      document.getElementById('cleanModal').classList.add('active');
    }

    function closeCleanModal() {
      document.getElementById('cleanModal').classList.remove('active');
    }

    async function executeClean() {
      const chkDeleteDup = document.getElementById('chkDeleteDup').checked;
      const chkDeleteTmp = document.getElementById('chkDeleteTmp').checked;

      if (!chkDeleteDup && !chkDeleteTmp) {
        showToast('Pilih setidaknya satu opsi pembersihan!', 'error');
        return;
      }

      const btnConfirm = document.getElementById('btnConfirmClean');
      const btnConfirmText = document.getElementById('btnConfirmText');
      btnConfirm.disabled = true;
      btnConfirmText.textContent = 'Menghapus in-place...';

      try {
        const response = await fetch('/api/clean', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deleteDuplicates: chkDeleteDup,
            deleteTmp: chkDeleteTmp
          })
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || 'Gagal membersihkan file.');
        }

        closeCleanModal();
        currentAuditData = result.updatedAudit;
        renderDashboard(currentAuditData);
        showToast(\`Pembersihan in-place sukses! \${result.deletedCount} file dihapus, \${result.freedFormatted} kapasitas berhasil dibebaskan!\`, 'success');

      } catch (err) {
        console.error(err);
        showToast('Gagal: ' + err.message, 'error');
      } finally {
        btnConfirm.disabled = false;
        btnConfirmText.textContent = 'Ya, Bersihkan Sekarang';
      }
    }

    async function seedSampleFiles() {
      try {
        const res = await fetch('/api/seed', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast('Data latihan Bahan Latihan P12 berhasil dibuat ulang!', 'success');
          document.getElementById('targetPathInput').value = './Bahan Latihan P12';
          startScan();
        }
      } catch (e) {
        showToast('Gagal mereset data: ' + e.message, 'error');
      }
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // Auto-scan pada load pertama jika target folder default ada
    window.addEventListener('DOMContentLoaded', () => {
      startScan();
    });
  </script>
</body>
</html>`;
}

/**
 * Server HTTP Native
 */
const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;
  const method = req.method;

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Helper untuk membaca JSON body
  function readJsonBody() {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
        if (body.length > 10 * 1024 * 1024) { // 10MB limit
          reject(new Error('Request body too large'));
        }
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (e) {
          reject(new Error('Format JSON tidak valid'));
        }
      });
      req.on('error', err => reject(err));
    });
  }

  // 1. GET & HEAD / -> Tampilan Dashboard Web UI
  if ((method === 'GET' || method === 'HEAD') && (pathname === '/' || pathname === '/index.html')) {
    const html = renderHtml();
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html, 'utf8')
    });
    if (method === 'HEAD') {
      res.end();
    } else {
      res.end(html);
    }
    return;
  }

  // 2. POST /api/scan -> Pindai folder target
  if (method === 'POST' && pathname === '/api/scan') {
    try {
      const body = await readJsonBody();
      const targetPath = body.targetPath || DEFAULT_TARGET_DIR;
      const audit = await performStorageAudit(targetPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, audit }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 3. POST /api/clean -> Eksekusi pembersihan in-place
  if (method === 'POST' && pathname === '/api/clean') {
    try {
      const body = await readJsonBody();
      const result = await cleanStorageInPlace(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 4. POST /api/seed -> Re-seed sampel data latihan
  if (method === 'POST' && pathname === '/api/seed') {
    try {
      seedSampleData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Sampel data berhasil dibuat!' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 5. 404 Not Found
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

// Jalankan Server
server.listen(PORT, () => {
  console.log('================================================================');
  console.log('⚡ StorageAudit Pro - Sistem Audit Penyimpanan Node.js Native');
  console.log(`📡 Server berjalan di: http://localhost:${PORT}`);
  console.log(`📁 Target folder default: ${DEFAULT_TARGET_DIR}`);
  console.log(`🛡️ Modul native: http, fs, path, crypto (Zero Dependency)`);
  console.log('================================================================');
});
