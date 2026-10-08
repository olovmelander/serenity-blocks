/** Derive campaign facts from registered orbs, excluding stale or debug-only save entries. */
export function getOdysseyCampaignSummary(registry, state) {
    const levels = registry?.getAllLevels?.() || [];
    const completed = levels.filter((level) => state?.isLevelCompleted?.(level.id));
    const starsFor = (level) => Math.max(0, Math.min(3, Number(state?.getLevelStars?.(level.id)) || 0));
    const chapters = (registry?.getAllChapters?.() || []).map((chapter) => {
        const orbs = levels.filter((level) => level.chapter === chapter.id);
        return {
            id: chapter.id,
            name: chapter.name,
            complete: orbs.length > 0 && orbs.every((level) => state?.isLevelCompleted?.(level.id)),
        };
    });
    return {
        complete: levels.length > 0 && completed.length === levels.length,
        completedOrbs: completed.length,
        totalOrbs: levels.length,
        chapters,
        completedChapters: chapters.filter((chapter) => chapter.complete).length,
        totalChapters: chapters.length,
        stars: completed.reduce((sum, level) => sum + starsFor(level), 0),
        maxStars: levels.length * 3,
        nextMasteryLevelId: levels.find((level) => state?.isLevelCompleted?.(level.id) && starsFor(level) < 3)?.id
            ?? null,
    };
}
