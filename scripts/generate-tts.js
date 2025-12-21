
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create WAV header for raw PCM data
function createWavHeader(dataLength, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
    const header = Buffer.alloc(44);
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);

    return header;
}

// Configuration
const SCRIPT_PATH = path.join(__dirname, 'tts-script.json');
const OUTPUT_BASE_DIR = path.join(__dirname, '../public/assets/audio/breathwork');
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
    console.error("Please set GEMINI_API_KEY environment variable.");
    console.error("Get your key from: https://aistudio.google.com/apikey");
    process.exit(1);
}

// Check for --overwrite flag
const OVERWRITE_MODE = process.argv.includes('--overwrite');
const TRACKING_FILE = path.join(__dirname, 'tts-audio-tracking.md');

async function generateAudio(text, voiceName, model) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

    // Embed style instruction directly with the text (single turn for Flash compatibility)
    const styledText = `[Speak calmly and meditatively, like a peaceful breathing guide] ${text}`;

    const payload = {
        contents: [
            { role: "user", parts: [{ text: styledText }] }
        ],
        generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: { voiceName }
                }
            }
        }
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || response.statusText);
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts;
    const audioPart = parts?.find(p => p.inlineData?.mimeType?.startsWith('audio'));

    if (!audioPart) {
        throw new Error('No audio in response');
    }

    const mimeType = audioPart.inlineData.mimeType;
    const rawBuffer = Buffer.from(audioPart.inlineData.data, 'base64');

    // Add WAV header for raw PCM
    if (mimeType.includes('L16') || mimeType.includes('pcm')) {
        const rateMatch = mimeType.match(/rate=(\d+)/);
        const sampleRate = rateMatch ? parseInt(rateMatch[1]) : 24000;
        const wavHeader = createWavHeader(rawBuffer.length, sampleRate);
        return Buffer.concat([wavHeader, rawBuffer]);
    }

    return rawBuffer;
}

async function main() {
    // Load manifest
    let manifest;
    try {
        const data = fs.readFileSync(SCRIPT_PATH, 'utf8');
        manifest = JSON.parse(data);
    } catch (err) {
        console.error(`Error loading script: ${err.message}`);
        return;
    }

    const config = manifest.voice_config;
    const model = config.model || "gemini-2.5-pro-preview-tts";
    const voiceName = config.voice_name || "Algieba";

    console.log(`Generating TTS audio files`);
    console.log(`Model: ${model}`);
    console.log(`Voice: ${voiceName}`);
    console.log(`Sessions: ${manifest.sessions.length}\n`);

    let totalFiles = 0;
    let skipped = 0;

    for (const session of manifest.sessions) {
        const sessionId = session.id;
        const clips = session.clips;

        // Create output directory
        const outputDir = path.join(OUTPUT_BASE_DIR, 'voices', sessionId);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        console.log(`\n[${sessionId.toUpperCase()}]`);

        for (const clip of clips) {
            // Use .wav extension since AI Studio returns PCM
            const wavFilename = clip.filename.replace('.mp3', '.wav');
            const outputPath = path.join(outputDir, wavFilename);

            if (fs.existsSync(outputPath) && !OVERWRITE_MODE) {
                console.log(`  ⏭ ${wavFilename} (exists)`);
                skipped++;
                continue;
            }

            const isOverwrite = fs.existsSync(outputPath);

            process.stdout.write(`  → ${wavFilename}... `);

            try {
                const audioBuffer = await generateAudio(clip.text, voiceName, model);
                fs.writeFileSync(outputPath, audioBuffer);
                const action = isOverwrite ? '↻' : '✓';
                console.log(`${action} (${Math.round(audioBuffer.length / 1024)}KB) [${model.includes('pro') ? 'PRO' : 'FLASH'}]`);
                totalFiles++;
            } catch (err) {
                console.log(`✗ ${err.message}`);
            }

            // Rate limit - wait 7 seconds AFTER EVERY request (success or fail)
            await new Promise(r => setTimeout(r, 7000));
        }
    }

    console.log(`\n✅ Done! Generated ${totalFiles} files, skipped ${skipped}`);
    console.log(`Output: ${OUTPUT_BASE_DIR}/voices/`);
    console.log(`Model used: ${model}`);
    if (OVERWRITE_MODE) {
        console.log(`Mode: OVERWRITE (replaced existing files)`);
    }
}

main();
