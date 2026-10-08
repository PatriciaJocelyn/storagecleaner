const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const baseDir = path.join(__dirname, 'Bahan Latihan P12');

// Ensure base directories
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
  if (!fs.existsSync(d)) {
    fs.mkdirSync(d, { recursive: true });
  }
});

// Helper to create buffer with unique content based on seed
function createDeterministicBuffer(seed, sizeBytes) {
  const buf = Buffer.alloc(sizeBytes);
  const hash = crypto.createHash('sha256').update(seed).digest();
  for (let i = 0; i < sizeBytes; i++) {
    buf[i] = hash[i % hash.length] ^ (i & 0xff);
  }
  return buf;
}

// 1. 5 Giant Duplicate Groups (> 2 MB = 2048 KB)
const giantDuplicateGroups = [
  {
    seed: 'giant_grp_1_modul_cloud',
    sizeBytes: Math.round(2.4 * 1024 * 1024), // 2.4 MB
    files: [
      path.join(baseDir, 'Dokumen', 'modul_pelatihan_cloud.pdf'),
      path.join(baseDir, 'Dokumen', 'Backup', 'modul_pelatihan_cloud_BACKUP.pdf'),
    ]
  },
  {
    seed: 'giant_grp_2_dataset_tx',
    sizeBytes: Math.round(3.2 * 1024 * 1024), // 3.2 MB
    files: [
      path.join(baseDir, 'Proyek', 'dataset_transaksi_2025.csv'),
      path.join(baseDir, 'Proyek', 'Arsip', 'dataset_transaksi_2025_salinan.csv'),
    ]
  },
  {
    seed: 'giant_grp_3_presentasi_dir',
    sizeBytes: Math.round(2.8 * 1024 * 1024), // 2.8 MB
    files: [
      path.join(baseDir, 'Dokumen', 'presentasi_final_direksi.pptx'),
      path.join(baseDir, 'Dokumen', 'Backup', 'presentasi_final_direksi_v2.pptx'),
    ]
  },
  {
    seed: 'giant_grp_4_video_workshop',
    sizeBytes: Math.round(4.5 * 1024 * 1024), // 4.5 MB
    files: [
      path.join(baseDir, 'Media', 'Videos', 'rekaman_workshop_part1.mp4'),
      path.join(baseDir, 'Media', 'rekaman_workshop_part1_copy.mp4'),
    ]
  },
  {
    seed: 'giant_grp_5_db_dump',
    sizeBytes: Math.round(3.6 * 1024 * 1024), // 3.6 MB
    files: [
      path.join(baseDir, 'Database', 'dump_database_staging.sql'),
      path.join(baseDir, 'Database', 'backup_dump_staging_old.sql'),
    ]
  }
];

// 2. 5 Unique Giant Files (> 2 MB)
const uniqueGiantFiles = [
  {
    seed: 'unique_giant_firmware',
    sizeBytes: Math.round(5.1 * 1024 * 1024), // 5.1 MB
    file: path.join(baseDir, 'Proyek', 'system_firmware_image.bin'),
  },
  {
    seed: 'unique_giant_arsip_zip',
    sizeBytes: Math.round(4.2 * 1024 * 1024), // 4.2 MB
    file: path.join(baseDir, 'Dokumen', 'Backup', 'arsip_dokumentasi_full.zip'),
  },
  {
    seed: 'unique_giant_nlp_weights',
    sizeBytes: Math.round(3.8 * 1024 * 1024), // 3.8 MB
    file: path.join(baseDir, 'Proyek', 'model_nlp_weights.dat'),
  },
  {
    seed: 'unique_giant_vector_ai',
    sizeBytes: Math.round(2.9 * 1024 * 1024), // 2.9 MB
    file: path.join(baseDir, 'Media', 'raw_vector_graphic_assets.ai'),
  },
  {
    seed: 'unique_giant_vmdk',
    sizeBytes: Math.round(6.5 * 1024 * 1024), // 6.5 MB
    file: path.join(baseDir, 'Proyek', 'Arsip', 'virtual_disk_snapshot.vmdk'),
  }
];

// 3. 15 Normal Duplicate Groups (< 2 MB)
const normalDuplicateGroups = [
  {
    seed: 'norm_grp_6_keuangan',
    sizeBytes: Math.round(1.2 * 1024 * 1024),
    files: [
      path.join(baseDir, 'Dokumen', 'laporan_keuangan_januari.xlsx'),
      path.join(baseDir, 'Dokumen', 'Backup', 'laporan_keuangan_januari_rev.xlsx')
    ]
  },
  {
    seed: 'norm_grp_7_onboarding',
    sizeBytes: 850 * 1024,
    files: [
      path.join(baseDir, 'Dokumen', 'panduan_onboarding.pdf'),
      path.join(baseDir, 'Dokumen', 'panduan_onboarding_karyawan.pdf')
    ]
  },
  {
    seed: 'norm_grp_8_foto_direktur',
    sizeBytes: 620 * 1024,
    files: [
      path.join(baseDir, 'Media', 'foto_profil_direktur.png'),
      path.join(baseDir, 'Media', 'foto_profil_direktur_web.png')
    ]
  },
  {
    seed: 'norm_grp_9_migrasi_py',
    sizeBytes: 120 * 1024,
    files: [
      path.join(baseDir, 'Proyek', 'script_migrasi_data.py'),
      path.join(baseDir, 'Proyek', 'Arsip', 'script_migrasi_data_backup.py')
    ]
  },
  {
    seed: 'norm_grp_10_banner_psd',
    sizeBytes: Math.round(1.8 * 1024 * 1024),
    files: [
      path.join(baseDir, 'Media', 'desain_banner_promo.psd'),
      path.join(baseDir, 'Media', 'desain_banner_promo_copy.psd')
    ]
  },
  {
    seed: 'norm_grp_11_peserta_csv',
    sizeBytes: 410 * 1024,
    files: [
      path.join(baseDir, 'Dokumen', 'daftar_peserta_pelatihan.csv'),
      path.join(baseDir, 'Dokumen', 'daftar_peserta_pelatihan_fix.csv')
    ]
  },
  {
    seed: 'norm_grp_12_jingle_wav',
    sizeBytes: Math.round(1.5 * 1024 * 1024),
    files: [
      path.join(baseDir, 'Media', 'audio_jingle_perusahaan.wav'),
      path.join(baseDir, 'Media', 'audio_jingle_final.wav')
    ]
  },
  {
    seed: 'norm_grp_13_kontrak_docx',
    sizeBytes: 340 * 1024,
    files: [
      path.join(baseDir, 'Dokumen', 'kontrak_kerja_template.docx'),
      path.join(baseDir, 'Dokumen', 'Backup', 'kontrak_kerja_template_lama.docx')
    ]
  },
  {
    seed: 'norm_grp_14_server_log',
    sizeBytes: 950 * 1024,
    files: [
      path.join(baseDir, 'Proyek', 'arsip_log_server_juni.log'),
      path.join(baseDir, 'Proyek', 'Arsip', 'arsip_log_server_juni_archive.log')
    ]
  },
  {
    seed: 'norm_grp_15_arsitektur_svg',
    sizeBytes: 280 * 1024,
    files: [
      path.join(baseDir, 'Media', 'infografis_arsitektur.svg'),
      path.join(baseDir, 'Dokumen', 'infografis_arsitektur_vector.svg')
    ]
  },
  {
    seed: 'norm_grp_16_skema_erd',
    sizeBytes: 750 * 1024,
    files: [
      path.join(baseDir, 'Database', 'skema_erd_database.png'),
      path.join(baseDir, 'Proyek', 'skema_erd_database_v1.png')
    ]
  },
  {
    seed: 'norm_grp_17_jadwal_xlsx',
    sizeBytes: 530 * 1024,
    files: [
      path.join(baseDir, 'Dokumen', 'jadwal_pelatihan_q4.xlsx'),
      path.join(baseDir, 'Dokumen', 'Backup', 'jadwal_pelatihan_q4_draft.xlsx')
    ]
  },
  {
    seed: 'norm_grp_18_sertifikat_pdf',
    sizeBytes: Math.round(1.1 * 1024 * 1024),
    files: [
      path.join(baseDir, 'Dokumen', 'sertifikat_kelulusan_master.pdf'),
      path.join(baseDir, 'Dokumen', 'Backup', 'sertifikat_kelulusan_master_copy.pdf')
    ]
  },
  {
    seed: 'norm_grp_19_katalog_pdf',
    sizeBytes: Math.round(1.7 * 1024 * 1024),
    files: [
      path.join(baseDir, 'Dokumen', 'katalog_produk_2026.pdf'),
      path.join(baseDir, 'Dokumen', 'katalog_produk_2026_cetak.pdf')
    ]
  },
  {
    seed: 'norm_grp_20_source_zip',
    sizeBytes: Math.round(1.9 * 1024 * 1024),
    files: [
      path.join(baseDir, 'Proyek', 'source_code_bundle.zip'),
      path.join(baseDir, 'Proyek', 'Arsip', 'source_code_bundle_backup.zip')
    ]
  }
];

// 4. Temporary / Junk files (.tmp)
const tmpFiles = [
  { file: path.join(baseDir, 'Temp', 'cache_session_01.tmp'), sizeBytes: 450 * 1024 },
  { file: path.join(baseDir, 'Temp', 'editor_autosave.tmp'), sizeBytes: 120 * 1024 },
  { file: path.join(baseDir, 'Dokumen', 'draft_unsaved.tmp'), sizeBytes: 280 * 1024 },
  { file: path.join(baseDir, 'Proyek', 'build_artifact.tmp'), sizeBytes: 600 * 1024 }
];

// 5. Normal Unique Files
const normalUniqueFiles = [
  { file: path.join(baseDir, 'README.txt'), sizeBytes: 4 * 1024 },
  { file: path.join(baseDir, 'Dokumen', 'kebijakan_privasi.docx'), sizeBytes: 180 * 1024 },
  { file: path.join(baseDir, 'Media', 'logo_icon.svg'), sizeBytes: 45 * 1024 }
];

console.log('Generating dummy files in:', baseDir);

// Write giant duplicate groups
giantDuplicateGroups.forEach((grp, idx) => {
  const buf = createDeterministicBuffer(grp.seed, grp.sizeBytes);
  grp.files.forEach(f => fs.writeFileSync(f, buf));
});

// Write unique giant files
uniqueGiantFiles.forEach(item => {
  const buf = createDeterministicBuffer(item.seed, item.sizeBytes);
  fs.writeFileSync(item.file, buf);
});

// Write normal duplicate groups
normalDuplicateGroups.forEach((grp, idx) => {
  const buf = createDeterministicBuffer(grp.seed, grp.sizeBytes);
  grp.files.forEach(f => fs.writeFileSync(f, buf));
});

// Write tmp files
tmpFiles.forEach(item => {
  const buf = createDeterministicBuffer('tmp_' + path.basename(item.file), item.sizeBytes);
  fs.writeFileSync(item.file, buf);
});

// Write normal unique files
normalUniqueFiles.forEach(item => {
  const buf = createDeterministicBuffer('unique_' + path.basename(item.file), item.sizeBytes);
  fs.writeFileSync(item.file, buf);
});

console.log('Sample data generated successfully!');
