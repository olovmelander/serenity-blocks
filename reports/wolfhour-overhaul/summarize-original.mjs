import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const directory = path.resolve(process.env.WOLFHOUR_CAPTURE_DIR || 'reports/wolfhour-overhaul');
const reportName = process.argv[2] || 'original-high-t8';
const report = JSON.parse(readFileSync(path.join(directory, `${reportName}.json`), 'utf8'));
if (report.error) throw new Error(`Capture failed: ${report.error}`);
const parse = result => JSON.parse(result.content[0].text.match(/```json\n([\s\S]*?)\n```/)[1]);
const summary = {
    createdAt: report.createdAt,
    viewport: report.viewport,
    url: report.url,
    seed: report.seed,
    t: report.t,
    quality: report.quality,
    pointerPose: report.pointerPose || null,
    compiledAssets: report.compiledAssets || [],
};
for (const key of ['repeat1', 'repeat2']) {
    const data = parse(report[key]);
    summary[key] = { gpuMs: data.gpuMs, cpuMs: data.cpuMs, frameMs: data.frameMs, uniqueContent: [...new Set(data.content.map(item => JSON.stringify(item)))].map(item => JSON.parse(item)), camera: data.stats.camera, width: data.stats.width, height: data.stats.height, memory: data.stats.memory };
}
summary.console = report.console.content[0].text;
summary.errors = parse(report.errors);
writeFileSync(path.join(directory, `${reportName}-summary.json`), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
