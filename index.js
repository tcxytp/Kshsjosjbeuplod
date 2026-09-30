import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key', 'key']
}));
app.options('*', cors());
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

const PORT = process.env.PORT || 3000;
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY ? process.env.ADMIN_SECRET_KEY.trim().replace(/^["']|["']$/g, '') : 'Vision@Admin7827#Secure';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

const cleanVal = (val) => val ? val.trim().replace(/^["']|["']$/g, '') : '';

function getSupabaseClients() {
  const clients = [];
  const registeredUrls = new Set();

  const primaryUrl = cleanVal(process.env.SUPABASE_URL);
  const primaryKey = cleanVal(process.env.SUPABASE_KEY);
  const primaryBucket = cleanVal(process.env.SUPABASE_BUCKET) || 'songs';

  if (primaryUrl && primaryKey) {
    try {
      clients.push({
        id: 1,
        name: "Account 1 (Primary)",
        client: createClient(primaryUrl, primaryKey),
        bucket: primaryBucket
      });
      registeredUrls.add(primaryUrl);
    } catch (e) {
      console.error("Primary Supabase client init error:", e.message);
    }
  }

  const envKeys = Object.keys(process.env);
  const detectedIndices = new Set();

  envKeys.forEach(k => {
    const match = k.match(/^SUPABASE_URL_(\d+)$/i);
    if (match) {
      detectedIndices.add(parseInt(match[1], 10));
    }
  });

  const sortedIndices = Array.from(detectedIndices).sort((a, b) => a - b);

  sortedIndices.forEach(idx => {
    const url = cleanVal(process.env[`SUPABASE_URL_${idx}`]);
    const key = cleanVal(process.env[`SUPABASE_KEY_${idx}`]);
    const bucket = cleanVal(process.env[`SUPABASE_BUCKET_${idx}`]) || primaryBucket || 'songs';

    if (url && key && !registeredUrls.has(url)) {
      try {
        clients.push({
          id: idx,
          name: `Account ${idx}`,
          client: createClient(url, key),
          bucket: bucket
        });
        registeredUrls.add(url);
      } catch (e) {
        console.error(`Account ${idx} Supabase client init error:`, e.message);
      }
    }
  });

  if (clients.length === 0 && primaryUrl) {
    clients.push({
      id: 1,
      name: "Account 1 (Fallback)",
      client: createClient(primaryUrl, primaryKey || 'dummy'),
      bucket: primaryBucket
    });
  }

  return clients;
}

function verifyAdmin(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['x-admin-key'] || req.query.key;
  const key = authHeader ? authHeader.replace('Bearer ', '').trim().replace(/^["']|["']$/g, '') : '';

  if (key === ADMIN_SECRET_KEY) {
    return next();
  }
  return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Admin Key' });
}

app.get('/', (req, res) => {
  res.send('Vision Music Admin Engine Live on Render.');
});

async function scanAccountRealFolders(acc) {
  try {
    const { data: rootItems, error } = await acc.client.storage
      .from(acc.bucket)
      .list('', { limit: 1000 });

    if (error || !rootItems) return [];

    const detectedFolders = new Set();
    rootItems.forEach(item => {
      if (item.name && !item.name.startsWith('.')) {
        if (item.id === null || !item.name.includes('.')) {
          detectedFolders.add(item.name.trim());
        }
      }
    });

    return Array.from(detectedFolders);
  } catch (err) {
    return [];
  }
}

app.get('/playlists', async (req, res) => {
  try {
    const accounts = getSupabaseClients();
    const seenMap = new Map();
    const folderPromises = accounts.map(acc => scanAccountRealFolders(acc));
    const allAccountFolders = await Promise.all(folderPromises);

    allAccountFolders.forEach(folders => {
      folders.forEach(f => {
        if (f && f.trim() !== '') {
          const norm = f.trim().toLowerCase();
          if (!seenMap.has(norm)) {
            seenMap.set(norm, f.trim());
          }
        }
      });
    });

    let list = Array.from(seenMap.values());
    if (list.length === 0) list.push("Hindi Songs");
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch playlists' });
  }
});

app.get('/songs', async (req, res) => {
  try {
    const accounts = getSupabaseClients();
    const songPromises = [];

    for (const acc of accounts) {
      const folders = await scanAccountRealFolders(acc);

      if (folders.length === 0) {
        songPromises.push((async () => {
          try {
            const { data: rootFiles } = await acc.client.storage
              .from(acc.bucket)
              .list('', { limit: 1000, sortBy: { column: 'name', order: 'asc' } });

            if (!rootFiles) return [];

            const audio = rootFiles.filter(f => f.name && f.name.match(/\.(mp3|wav|m4a|aac|ogg|flac)$/i));
            return audio.map((file, idx) => {
              const { data: urlData } = acc.client.storage.from(acc.bucket).getPublicUrl(file.name);
              return {
                id: `root_${acc.id}_${idx + 1}`,
                fileName: file.name,
                title: file.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ').trim(),
                url: urlData.publicUrl,
                playlist: "Hindi Songs",
                sizeBytes: file.metadata?.size || 0,
                accountId: acc.id
              };
            });
          } catch (e) {
            return [];
          }
        })());
      } else {
        for (const folder of folders) {
          songPromises.push((async () => {
            try {
              const { data: files } = await acc.client.storage
                .from(acc.bucket)
                .list(folder, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });

              if (!files || files.length === 0) return [];

              const audioFiles = files.filter(f =>
                f.name && !f.name.startsWith('.') &&
                f.name.match(/\.(mp3|wav|m4a|aac|ogg|flac)$/i)
              );

              return audioFiles.map((file, idx) => {
                const filePath = `${folder}/${file.name}`;
                const { data: urlData } = acc.client.storage
                  .from(acc.bucket)
                  .getPublicUrl(filePath);

                const cleanTitle = file.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ').trim();

                return {
                  id: `${folder.toLowerCase().replace(/[^a-z0-9]/g, '')}_${acc.id}_${idx + 1}`,
                  fileName: file.name,
                  title: cleanTitle,
                  url: urlData.publicUrl,
                  playlist: folder,
                  sizeBytes: file.metadata?.size || 0,
                  accountId: acc.id
                };
              });
            } catch (e) {
              return [];
            }
          })());
        }
      }
    }

    const results = await Promise.all(songPromises);
    res.json(results.flat());
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tracks' });
  }
});

app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  const key = (password || '').trim().replace(/^["']|["']$/g, '');

  if (key === ADMIN_SECRET_KEY) {
    return res.json({ success: true, message: 'Authenticated successfully' });
  }
  return res.status(401).json({ success: false, error: 'Incorrect Access Key' });
});

app.get('/admin/accounts-overview', verifyAdmin, async (req, res) => {
  try {
    const accounts = getSupabaseClients();
    const overviewPromises = accounts.map(async (acc) => {
      try {
        const realFolders = await scanAccountRealFolders(acc);
        let totalSizeBytes = 0;
        let totalSongsCount = 0;
        const folderBreakdown = {};

        const folderPromises = realFolders.map(async (folder) => {
          try {
            const { data: files } = await acc.client.storage.from(acc.bucket).list(folder, { limit: 1000 });
            const audioFiles = (files || []).filter(f =>
              f.name && !f.name.startsWith('.') && f.name.match(/\.(mp3|wav|m4a|aac|ogg|flac)$/i)
            );

            let folderBytes = 0;
            audioFiles.forEach(f => { folderBytes += f.metadata?.size || 0; });

            return { bytes: folderBytes, count: audioFiles.length, folder };
          } catch (e) {
            return { bytes: 0, count: 0, folder };
          }
        });

        const folderResults = await Promise.all(folderPromises);
        folderResults.forEach(resItem => {
          totalSizeBytes += resItem.bytes;
          totalSongsCount += resItem.count;
          folderBreakdown[resItem.folder] = resItem.count;
        });

        const ONE_GB_BYTES = 1024 * 1024 * 1024;
        const isFull = totalSizeBytes >= ONE_GB_BYTES;
        const usedMB = (totalSizeBytes / (1024 * 1024)).toFixed(2);
        const usedGB = (totalSizeBytes / (1024 * 1024 * 1024)).toFixed(3);
        const percentUsed = Math.min(100, ((totalSizeBytes / ONE_GB_BYTES) * 100)).toFixed(1);

        return {
          id: acc.id,
          name: acc.name,
          bucket: acc.bucket,
          totalSongs: totalSongsCount,
          usedBytes: totalSizeBytes,
          usedMB: usedMB,
          usedGB: usedGB,
          percentUsed: percentUsed,
          isFull: isFull,
          folders: realFolders,
          folderBreakdown: folderBreakdown
        };
      } catch (err) {
        return {
          id: acc.id,
          name: acc.name,
          bucket: acc.bucket,
          totalSongs: 0,
          usedBytes: 0,
          usedMB: "0.00",
          usedGB: "0.000",
          percentUsed: "0.0",
          isFull: false,
          folders: [],
          folderBreakdown: {}
        };
      }
    });

    const overview = await Promise.all(overviewPromises);
    res.json({ success: true, accounts: overview });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/admin/create-playlist', verifyAdmin, async (req, res) => {
  try {
    const { accountId, playlistName } = req.body;
    if (!playlistName || !playlistName.trim()) {
      return res.status(400).json({ success: false, error: 'Playlist name required' });
    }

    const cleanFolder = playlistName.trim().replace(/[/\\?%*:|"<>]/g, '');
    const accounts = getSupabaseClients();
    const acc = accounts.find(a => a.id === parseInt(accountId, 10)) || accounts[0];

    const placeholderPath = `${cleanFolder}/.init`;
    const emptyBuf = Buffer.from('vision-folder-manifest');

    const { error } = await acc.client.storage
      .from(acc.bucket)
      .upload(placeholderPath, emptyBuf, { upsert: true });

    if (!error) {
      res.json({ success: true, message: `Playlist "${cleanFolder}" created successfully!` });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/admin/rename-playlist', verifyAdmin, async (req, res) => {
  try {
    const { oldPlaylistName, newPlaylistName, accountId } = req.body;
    if (!oldPlaylistName || !newPlaylistName) {
      return res.status(400).json({ success: false, error: 'Both playlist names required' });
    }

    const cleanNewName = newPlaylistName.trim().replace(/[/\\?%*:|"<>]/g, '');
    const accounts = getSupabaseClients();
    let targetAccs = accountId ? accounts.filter(a => a.id === parseInt(accountId, 10)) : accounts;

    for (const acc of targetAccs) {
      const { data: files } = await acc.client.storage.from(acc.bucket).list(oldPlaylistName, { limit: 1000 });
      if (files && files.length > 0) {
        for (const file of files) {
          const oldPath = `${oldPlaylistName}/${file.name}`;
          const newPath = `${cleanNewName}/${file.name}`;
          await acc.client.storage.from(acc.bucket).move(oldPath, newPath);
        }
      } else {
        await acc.client.storage.from(acc.bucket).upload(`${cleanNewName}/.init`, Buffer.from('vision-folder-manifest'), { upsert: true });
        await acc.client.storage.from(acc.bucket).remove([`${oldPlaylistName}/.init`]);
      }
    }

    res.json({ success: true, message: `Playlist renamed successfully!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/admin/delete-playlist', verifyAdmin, async (req, res) => {
  try {
    const { playlistName, accountId } = req.body;
    if (!playlistName) {
      return res.status(400).json({ success: false, error: 'Playlist name required' });
    }

    const accounts = getSupabaseClients();
    let targetAccs = accountId ? accounts.filter(a => a.id === parseInt(accountId, 10)) : accounts;

    for (const acc of targetAccs) {
      const { data: files } = await acc.client.storage.from(acc.bucket).list(playlistName, { limit: 1000 });
      if (files && files.length > 0) {
        const filePaths = files.map(f => `${playlistName}/${f.name}`);
        await acc.client.storage.from(acc.bucket).remove(filePaths);
      }
      await acc.client.storage.from(acc.bucket).remove([`${playlistName}/.init`]);
    }

    res.json({ success: true, message: `Playlist deleted successfully!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/admin/upload', verifyAdmin, upload.array('songFiles', 50), async (req, res) => {
  try {
    const { accountId, playlist } = req.body;
    const files = req.files;

    if (!files || files.length === 0 || !playlist) {
      return res.status(400).json({ success: false, error: 'Files and Playlist are required' });
    }

    const accounts = getSupabaseClients();
    let targetAcc = accountId ? accounts.find(a => a.id === parseInt(accountId, 10)) : accounts[0];
    if (!targetAcc) targetAcc = accounts[0];

    let uploadedCount = 0;
    for (const file of files) {
      const cleanBaseName = file.originalname.replace(/\.[^/.]+$/, '').trim().replace(/[/\\?%*:|"<>]/g, '');
      const cleanFileName = `${cleanBaseName}.mp3`;
      const targetFilePath = `${playlist}/${cleanFileName}`;

      const { error } = await targetAcc.client.storage
        .from(targetAcc.bucket)
        .upload(targetFilePath, file.buffer, { contentType: file.mimetype || 'audio/mpeg', upsert: true });

      if (!error) uploadedCount++;
    }

    res.json({
      success: true,
      message: `Uploaded ${uploadedCount} songs successfully!`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/admin/delete', verifyAdmin, async (req, res) => {
  try {
    const { accountId, playlist, fileName } = req.body;
    if (!playlist || !fileName) {
      return res.status(400).json({ success: false, error: 'Playlist & fileName required' });
    }

    const targetFilePath = `${playlist}/${fileName}`;
    const accounts = getSupabaseClients();
    let targetAcc = accountId ? accounts.find(a => a.id === parseInt(accountId, 10)) : accounts[0];

    const { error } = await targetAcc.client.storage.from(targetAcc.bucket).remove([targetFilePath]);
    if (!error) {
      return res.json({ success: true, message: `Song deleted.` });
    }
    res.status(500).json({ success: false, error: 'Could not remove file' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/admin/rename', verifyAdmin, async (req, res) => {
  try {
    const { accountId, playlist, oldFileName, newTitle } = req.body;
    if (!playlist || !oldFileName || !newTitle) {
      return res.status(400).json({ success: false, error: 'Missing parameters' });
    }

    const cleanNewFileName = `${newTitle.trim().replace(/[/\\?%*:|"<>]/g, '')}.mp3`;
    const oldPath = `${playlist}/${oldFileName}`;
    const newPath = `${playlist}/${cleanNewFileName}`;

    const accounts = getSupabaseClients();
    let targetAcc = accountId ? accounts.find(a => a.id === parseInt(accountId, 10)) : accounts[0];

    const { error } = await targetAcc.client.storage.from(targetAcc.bucket).move(oldPath, newPath);

    if (!error) res.json({ success: true, message: `Renamed successfully!` });
    else res.status(500).json({ success: false, error: error.message });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Admin Server listening on port ${PORT}`);
});
