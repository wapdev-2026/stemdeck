import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '15mb' }));

interface StemClassifyInput {
  id: string;
  fileName: string;
  rawName: string;
  duration: number;
  channels: number;
  acousticProfile: {
    rmsDb: number;
    peakDb: number;
    crestFactorDb: number;
    zeroCrossingRate: number;
    lowEnergyRatio: number;
    midEnergyRatio: number;
    highEnergyRatio: number;
  };
  audioSnippetBase64?: string;
}

app.post('/api/classify-stems', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({
        error:
          'GEMINI_API_KEY is not configured. Please check the API key in the Settings > Secrets panel.',
      });
      return;
    }

    const stems: StemClassifyInput[] = Array.isArray(req.body?.stems) ? req.body.stems : [];
    if (stems.length === 0) {
      res.status(400).json({ error: 'No stems provided for AI classification.' });
      return;
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      {
        text: `You are an expert audio engineer and stem classifier for a multitrack stem mixer (like Moises).
Analyze each provided stem using its filename, computed acoustic telemetry, and any attached short audio excerpt.
For every stem, classify it into the most accurate musical stem role and return a clean, human-friendly display label (such as "Vocals", "Lead Vocals", "Background Vocals", "Drums", "Bass", "Guitar", "Keys", "Strings", "Synth", "Percussion", or "Other").

Pay special attention to distinguishing:
- "Vocals" / "Lead Vocals" vs "Background" / "Background Vocals" (backing harmonies, choirs, ad-libs, bgv, bv, backing)
- "Drums" (kick, snare, hi-hat, drum kit, percussion)
- "Bass" (bass guitar, sub bass, synth bass)
- "Keys" (piano, rhodes, organ, keyboard)
- "Guitar" (acoustic, electric, rhythm, lead guitar)
- "Synth" / "Strings" / "Brass" / "Other"

Return one classification object per input stem ID.`,
      },
    ];

    for (const stem of stems) {
      parts.push({
        text: `Stem ID: "${stem.id}"
Original File: "${stem.fileName}"
Raw Stem Name: "${stem.rawName}"
Duration: ${stem.duration.toFixed(1)}s (${stem.channels === 1 ? 'Mono' : 'Stereo'})
Acoustic Telemetry:
- RMS Level: ${stem.acousticProfile.rmsDb.toFixed(1)} dBFS
- Peak Level: ${stem.acousticProfile.peakDb.toFixed(1)} dBFS
- Crest Factor (Transient Dynamic Ratio): ${stem.acousticProfile.crestFactorDb.toFixed(1)} dB
- Zero-Crossing Rate: ${stem.acousticProfile.zeroCrossingRate.toFixed(0)} Hz
- Spectral Energy Balance: Low=${Math.round(stem.acousticProfile.lowEnergyRatio * 100)}%, Mid=${Math.round(stem.acousticProfile.midEnergyRatio * 100)}%, High=${Math.round(stem.acousticProfile.highEnergyRatio * 100)}%`,
      });

      if (stem.audioSnippetBase64) {
        parts.push({
          inlineData: {
            mimeType: 'audio/wav',
            data: stem.audioSnippetBase64,
          },
        });
      }
    }

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: { parts },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: {
                type: Type.STRING,
                description: 'Exact id of the stem from the input.',
              },
              category: {
                type: Type.STRING,
                description:
                  'Normalized stem category: "Vocals", "Background", "Drums", "Bass", "Guitar", "Keys", "Synth", or "Other".',
              },
              displayName: {
                type: Type.STRING,
                description:
                  'Clean, concise title-case label to display for this stem (e.g. "Vocals", "Background Vocals", "Drums", "Bass", "Keys", "Electric Guitar").',
              },
              characterNote: {
                type: Type.STRING,
                description:
                  'Brief 3-6 word description of the stem character (e.g. "Lead vocal melody track", "Harmonic backing vocal layer", "Punchy drum kit groove").',
              },
            },
            required: ['id', 'category', 'displayName', 'characterNote'],
          },
        },
      },
    });

    const jsonText = (response.text ?? '[]').trim();
    const classifications = JSON.parse(jsonText);
    res.json({ classifications });
  } catch (err: unknown) {
    console.error('Gemini stem classification error:', err);
    const message =
      err instanceof Error ? err.message : 'Failed to classify stems with Gemini API.';
    res.status(500).json({ error: message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`StemDeck server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
