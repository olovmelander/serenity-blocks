
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
const FLASH_ONLY_MODE = process.argv.includes('--flash-only');
const TRACKING_FILE = path.join(__dirname, 'tts-audio-tracking.md');

// Check for --only flag (e.g., --only=out_power.wav,in_quick.wav)
const onlyArg = process.argv.find(a => a.startsWith('--only='));
const ONLY_FILES = onlyArg ? onlyArg.split('=')[1].split(',').map(f => f.trim()) : null;

// Sessions that were previously generated with FLASH model (per tts-audio-tracking.md)
const FLASH_SESSIONS = ['cues', 'intentions', 'fillers'];

// Update the tracking markdown file when a file is generated with PRO
function updateTrackingFile(sessionId, filename, modelTag) {
    try {
        let content = fs.readFileSync(TRACKING_FILE, 'utf8');

        // Update the checkbox for this file (mark as completed)
        const filePattern = new RegExp(`\\[ \\] ${sessionId}/${filename}`, 'g');
        content = content.replace(filePattern, `[x] ${sessionId}/${filename}`);

        // Also check for files listed with multiple on one line
        const altPattern = new RegExp(`(${filename})(?!\\])`, 'g');

        // Update the "Last Updated" date
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        content = content.replace(/\*\*Last Updated:\*\* .+/, `**Last Updated:** ${today}`);

        fs.writeFileSync(TRACKING_FILE, content);
    } catch (err) {
        // Silently fail if tracking file doesn't exist or can't be updated
    }
}

async function generateAudio(text, voiceName, model, retries = 3) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

    // Pad very short text to help the API (single words can fail)
    let styledText = text;
    if (text.length < 10) {
        styledText = `[Speak calmly and clearly] Say: "${text}"`;
    } else {
        styledText = `[Speak calmly and meditatively, like a peaceful breathing guide] ${text}`;
    }

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
        if (retries > 0) {
            console.log(`⟳ retry (${retries} left)... `);
            await new Promise(r => setTimeout(r, 3000));
            return generateAudio(text, voiceName, model, retries - 1);
        }
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
    if (FLASH_ONLY_MODE) {
        console.log(`Mode: FLASH-ONLY (regenerating cues, intentions, fillers)`);
    }
    console.log(`Sessions: ${manifest.sessions.length}\n`);

    let totalFiles = 0;
    let skipped = 0;

    for (const session of manifest.sessions) {
        const sessionId = session.id;
        const clips = session.clips;

        // Skip non-FLASH sessions if --flash-only mode
        if (FLASH_ONLY_MODE && !FLASH_SESSIONS.includes(sessionId)) {
            console.log(`\n[${sessionId.toUpperCase()}] ⏭ (already PRO)`);
            continue;
        }

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

            // Skip if --only flag is set and this file is not in the list
            if (ONLY_FILES && !ONLY_FILES.includes(wavFilename)) {
                continue;
            }

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
                const modelTag = model.includes('pro') ? 'PRO' : 'FLASH';
                console.log(`${action} (${Math.round(audioBuffer.length / 1024)}KB) [${modelTag}]`);
                totalFiles++;

                // Log successful PRO generation
                if (model.includes('pro')) {
                    const logEntry = `${new Date().toISOString()} | ${sessionId}/${wavFilename} | PRO | ${Math.round(audioBuffer.length / 1024)}KB\n`;
                    fs.appendFileSync(path.join(__dirname, 'tts-pro-generated.log'), logEntry);
                    updateTrackingFile(sessionId, wavFilename, 'PRO');
                }
            } catch (err) {
                console.log(`✗ ${err.message}`);
                // Log failed attempts
                const logEntry = `${new Date().toISOString()} | ${sessionId}/${wavFilename} | FAILED | ${err.message}\n`;
                fs.appendFileSync(path.join(__dirname, 'tts-pro-generated.log'), logEntry);
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
