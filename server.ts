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

app.use(express.json({ limit: '25mb' }));

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
    spectralCentroidHz?: number;
    stereoWidthRatio?: number;
    activeRatio?: number;
  };
  audioSnippetBase64?: string;
}

interface ClassificationResult {
  id: string;
  category: string;
  displayName: string;
  characterNote: string;
  source: 'ai' | 'heuristic';
}

function classifyStemDeterministicServer(stem: StemClassifyInput): ClassificationResult {
  const combined = `${stem.rawName} ${stem.fileName}`.toLowerCase();
  const ap = stem.acousticProfile;

  // 1. Background / Backing Vocals / Choir / Harmonies (multi-language Moises conventions)
  if (
    /\b(bgv|bv|b\.?vocals?|background|backing|harmon(y|ies)|choir|coros?|back\s*vox|ad\s*libs?|second\s*vocal|double\s*vox)\b/i.test(
      combined
    ) ||
    combined.includes('background') ||
    combined.includes('backing') ||
    combined.includes('bgv') ||
    combined.includes('coro') ||
    combined.includes('harmon')
  ) {
    return {
      id: stem.id,
      category: 'Background',
      displayName: 'Background Vocals',
      characterNote: 'Harmonic backing vocal layer',
      source: 'heuristic',
    };
  }

  // 2. Lead Vocals
  if (
    /\b(lead\s*vocals?|main\s*vocals?|vocals?|vox|voice|voz|voces|singer|chant|gesang|acappella|acapella)\b/i.test(
      combined
    ) ||
    combined.includes('vocal') ||
    combined.includes('vox') ||
    combined.includes('voz')
  ) {
    return {
      id: stem.id,
      category: 'Vocals',
      displayName: combined.includes('lead') ? 'Lead Vocals' : 'Vocals',
      characterNote: 'Primary vocal melody track',
      source: 'heuristic',
    };
  }

  // 3. Drums & Percussion
  if (
    /\b(drums?|drumkit|kit|percussion|perc|bateria|batería|kick|snare|hi[\s-]?hat|cymbals?|toms?|beat|claps?|shaker|congas?|bongos?)\b/i.test(
      combined
    ) ||
    combined.includes('drum') ||
    combined.includes('perc') ||
    combined.includes('bateria')
  ) {
    const isPerc =
      (combined.includes('perc') && !combined.includes('drum')) ||
      combined.includes('shaker') ||
      combined.includes('conga');
    return {
      id: stem.id,
      category: 'Drums',
      displayName: isPerc ? 'Percussion' : 'Drums',
      characterNote: isPerc ? 'Rhythmic percussion groove' : 'Punchy drum kit groove',
      source: 'heuristic',
    };
  }

  // 4. Bass
  if (
    /\b(bass|bassline|sub[\s-]?bass|808|bajo|baixo|basse|contrabass|upright\s*bass|synth\s*bass)\b/i.test(
      combined
    ) ||
    combined.includes('bass') ||
    combined.includes('bajo') ||
    combined.includes('baixo')
  ) {
    return {
      id: stem.id,
      category: 'Bass',
      displayName: combined.includes('synth') ? 'Synth Bass' : 'Bass',
      characterNote: 'Low-end rhythmic bass foundation',
      source: 'heuristic',
    };
  }

  // 5. Guitar
  if (
    /\b(guitars?|gtr|guitarra|ac[\s_-]?gtr|el[\s_-]?gtr|acoustic\s*guitar|electric\s*guitar|rhythm\s*guitar|lead\s*guitar|clean\s*guitar|distorted\s*guitar)\b/i.test(
      combined
    ) ||
    combined.includes('guitar') ||
    combined.includes('gtr')
  ) {
    let displayName = 'Guitar';
    if (combined.includes('acoustic')) displayName = 'Acoustic Guitar';
    else if (combined.includes('electric')) displayName = 'Electric Guitar';
    else if (combined.includes('lead')) displayName = 'Lead Guitar';
    else if (combined.includes('rhythm')) displayName = 'Rhythm Guitar';
    return {
      id: stem.id,
      category: 'Guitar',
      displayName,
      characterNote: `${displayName} harmonic track`,
      source: 'heuristic',
    };
  }

  // 6. Keys / Piano / Organ
  if (
    /\b(keys|keyboards?|piano|pno|organ|rhodes|wurli|wurlitzer|clav|clavinet|teclado|epiano|electric\s*piano)\b/i.test(
      combined
    ) ||
    combined.includes('piano') ||
    combined.includes('keys') ||
    combined.includes('organ') ||
    combined.includes('rhodes') ||
    combined.includes('teclado')
  ) {
    let displayName = 'Keys';
    if (combined.includes('piano')) displayName = 'Piano';
    else if (combined.includes('organ')) displayName = 'Organ';
    else if (combined.includes('rhodes')) displayName = 'Rhodes';
    return {
      id: stem.id,
      category: 'Keys',
      displayName,
      characterNote: `${displayName} chordal accompaniment`,
      source: 'heuristic',
    };
  }

  // 7. Synth / Strings / Pads / Brass
  if (
    /\b(synths?|synthesizer|pad|strings?|orchestra|brass|horns?|arp|arpeggio|lead\s*synth|pluck)\b/i.test(
      combined
    ) ||
    combined.includes('synth') ||
    combined.includes('string') ||
    combined.includes('pad') ||
    combined.includes('brass')
  ) {
    let displayName = 'Synth';
    if (combined.includes('string')) displayName = 'Strings';
    else if (combined.includes('pad')) displayName = 'Synth Pad';
    else if (combined.includes('brass') || combined.includes('horn')) displayName = 'Brass';
    return {
      id: stem.id,
      category: 'Synth',
      displayName,
      characterNote: `${displayName} texture & layer`,
      source: 'heuristic',
    };
  }

  // 8. Acoustic Telemetry Classification when filename is generic (e.g., "Track 1", "Stem 02", "Audio_3")
  if (ap.lowEnergyRatio > 0.62 && ap.zeroCrossingRate < 500) {
    return {
      id: stem.id,
      category: 'Bass',
      displayName: 'Bass',
      characterNote: 'Deep low-frequency bass stem',
      source: 'heuristic',
    };
  }

  if (ap.crestFactorDb > 12.2 && (ap.highEnergyRatio > 0.16 || ap.zeroCrossingRate > 1200)) {
    return {
      id: stem.id,
      category: 'Drums',
      displayName: 'Drums',
      characterNote: 'High-transient percussive stem',
      source: 'heuristic',
    };
  }

  if (ap.midEnergyRatio > 0.52 && (ap.stereoWidthRatio ?? 0.2) > 0.32) {
    return {
      id: stem.id,
      category: 'Background',
      displayName: 'Background Vocals',
      characterNote: 'Wide stereo mid-range harmonic layer',
      source: 'heuristic',
    };
  }

  if (ap.midEnergyRatio > 0.5 && ap.crestFactorDb >= 7.5 && ap.crestFactorDb <= 13.5) {
    return {
      id: stem.id,
      category: 'Vocals',
      displayName: 'Vocals',
      characterNote: 'Mid-focused melodic vocal stem',
      source: 'heuristic',
    };
  }

  if (ap.midEnergyRatio > 0.45 && ap.lowEnergyRatio > 0.25) {
    return {
      id: stem.id,
      category: 'Keys',
      displayName: 'Keys',
      characterNote: 'Balanced harmonic instrument stem',
      source: 'heuristic',
    };
  }

  return {
    id: stem.id,
    category: 'Other',
    displayName: stem.rawName.trim() || 'Other',
    characterNote: 'Auxiliary instrument stem',
    source: 'heuristic',
  };
}

function buildClassificationPromptParts(
  stems: StemClassifyInput[],
  includeAudioSnippets: boolean
): Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> {
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    {
      text: `You are an expert studio audio engineer and multitrack stem classifier for StemDeck (used with Moises, Logic, Ableton, and Stem Roller exports).
You are given a batch of ${stems.length} stems from the same multitrack session.
Analyze each stem holistically using:
1. Its filename & raw stem name (including abbreviations like vox, bgv, bv, pno, gtr, drm, perc, or non-English terms like voz, coros, bateria, bajo, baixo, guitarra, teclado, outros).
2. Its acoustic DSP telemetry (RMS, Peak, Transient Crest Factor, Zero-Crossing Rate, Low/Mid/High Spectral Energy, Spectral Centroid Hz, Stereo Width Ratio, and Active Duty Cycle).
3. Any attached audio snippet.
4. Mutual session context across all ${stems.length} stems in the batch (for example, in a 4-stem or 5-stem export, roles typically partition into Vocals, Background Vocals, Drums, Bass, Guitar, Keys, Synth, or Other).

Category rules:
- "Vocals": Lead vocals, main vocals, solo voice, rap vocals.
- "Background": Background vocals, backing harmonies, choir, bgv, ad-libs, vocal doubles.
- "Drums": Drum kit, kick, snare, hi-hat, cymbals, percussion, beat, claps.
- "Bass": Electric bass, synth bass, sub bass, upright bass, 808.
- "Guitar": Acoustic guitar, electric guitar, lead guitar, rhythm guitar.
- "Keys": Piano, electric piano, Rhodes, organ, clavinet, keyboards.
- "Synth": Synthesizers, synth pads, strings, brass, arpeggios.
- "Other": Click/metronome, sound effects, full instrumental, or unclassified auxiliary tracks.

Return one JSON object for EVERY input stem ID.`,
    },
  ];

  for (const stem of stems) {
    const ap = stem.acousticProfile;
    parts.push({
      text: `Stem ID: "${stem.id}"
Original File: "${stem.fileName}"
Raw Stem Name: "${stem.rawName}"
Duration: ${stem.duration.toFixed(1)}s (${stem.channels === 1 ? 'Mono' : 'Stereo'})
Acoustic Telemetry:
- RMS Level: ${ap.rmsDb.toFixed(1)} dBFS | Peak Level: ${ap.peakDb.toFixed(1)} dBFS
- Crest Factor (Transient Dynamic Ratio): ${ap.crestFactorDb.toFixed(1)} dB
- Zero-Crossing Rate: ${ap.zeroCrossingRate.toFixed(0)} Hz | Spectral Centroid: ${(ap.spectralCentroidHz ?? 1000).toFixed(0)} Hz
- Stereo Width Ratio: ${Math.round((ap.stereoWidthRatio ?? 0.15) * 100)}% | Active Duty Cycle: ${Math.round((ap.activeRatio ?? 0.7) * 100)}%
- Spectral Energy Balance: Low=${Math.round(ap.lowEnergyRatio * 100)}%, Mid=${Math.round(ap.midEnergyRatio * 100)}%, High=${Math.round(ap.highEnergyRatio * 100)}%`,
    });

    if (includeAudioSnippets && stem.audioSnippetBase64) {
      parts.push({
        inlineData: {
          mimeType: 'audio/wav',
          data: stem.audioSnippetBase64,
        },
      });
    }
  }

  return parts;
}

const RESPONSE_SCHEMA = {
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
};

function parseGeminiJsonList(rawText: string): Array<{
  id?: string;
  category?: string;
  displayName?: string;
  characterNote?: string;
}> {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const parsed = JSON.parse(cleaned);
  return Array.isArray(parsed) ? parsed : [];
}

app.post('/api/classify-stems', async (req, res) => {
  const stems: StemClassifyInput[] = Array.isArray(req.body?.stems) ? req.body.stems : [];
  if (stems.length === 0) {
    res.status(400).json({ error: 'No stems provided for AI classification.' });
    return;
  }

  const fallbackList = stems.map((s) => classifyStemDeterministicServer(s));
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    res.json({ classifications: fallbackList, source: 'heuristic' });
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

  let rawModelItems: Array<{
    id?: string;
    category?: string;
    displayName?: string;
    characterNote?: string;
  }> | null = null;

  // Attempt 1: Multimodal (Telemetry + Filenames + Audio Snippets)
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: { parts: buildClassificationPromptParts(stems, true) },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    });
    rawModelItems = parseGeminiJsonList(response.text ?? '[]');
  } catch (firstErr) {
    console.warn('Multimodal stem classification retry (falling back to telemetry-only prompt):', firstErr);
    // Attempt 2: Telemetry + Filenames only (faster & smaller payload)
    try {
      const retryResponse = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts: buildClassificationPromptParts(stems, false) },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      });
      rawModelItems = parseGeminiJsonList(retryResponse.text ?? '[]');
    } catch (secondErr) {
      console.warn('Gemini stem classification fallback to deterministic acoustic engine:', secondErr);
    }
  }

  if (!rawModelItems || rawModelItems.length === 0) {
    res.json({ classifications: fallbackList, source: 'heuristic' });
    return;
  }

  const byId = new Map<string, (typeof rawModelItems)[number]>();
  for (const item of rawModelItems) {
    if (item && typeof item.id === 'string') {
      byId.set(item.id, item);
    }
  }

  // Merge AI output with deterministic fallback so every stem ID is guaranteed a rich result
  const finalClassifications: ClassificationResult[] = stems.map((stem, index) => {
    const matched = byId.get(stem.id) ?? rawModelItems?.[index];
    const fallback = fallbackList[index];

    if (!matched || (!matched.category && !matched.displayName)) {
      return fallback;
    }

    return {
      id: stem.id,
      category: matched.category?.trim() || fallback.category,
      displayName: matched.displayName?.trim() || fallback.displayName,
      characterNote: matched.characterNote?.trim() || fallback.characterNote,
      source: 'ai',
    };
  });

  res.json({ classifications: finalClassifications, source: 'ai' });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
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
