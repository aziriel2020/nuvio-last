#!/usr/bin/env python3
"""Patch upstream Nuvio Mobile to load calendar period posters on demand.

This patch is deliberately scoped to Nuvio multi-period addon folders.
It does not change database/collection JSON, platform data, or other addons.
"""
from pathlib import Path
import sys

BASE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("NuvioMobile")
TARGET = BASE / "composeApp/src/commonMain/kotlin/com/nuvio/app/features/collection/FolderDetailRepository.kt"

def once(source, before, after):
    count = source.count(before)
    if count != 1:
        raise SystemExit(f"Expected exactly one source anchor, got {count}: {before[:100]!r}")
    return source.replace(before, after, 1)

def main():
    if not TARGET.is_file():
        raise SystemExit(f"Missing upstream source: {TARGET}")
    source = TARGET.read_text(encoding="utf-8")
    original = source

    source = once(source,
        "    val isLoadingMore: Boolean = false,\n",
        "    val isLoadingMore: Boolean = false,\n    val hasLoaded: Boolean = false,\n")

    source = once(source,
        "        val sources = folder.resolvedSources\n        val showAll = collection.showAllTab && sources.size > 1\n",
        "        val sources = folder.resolvedSources\n"
        "        // Calendar folders may have hundreds of date sources. Fetching all at\n"
        "        // once overloads the server, network and poster renderer.\n"
        "        val isNuvioPeriodFolder = sources.size >= 8 && sources.all {\n"
        "            it.addonId?.startsWith(\"com.nuvio.\") == true\n"
        "        }\n"
        "        val showAll = collection.showAllTab && sources.size > 1 && !isNuvioPeriodFolder\n")

    source = once(source,
        "            viewMode = collection.folderViewMode,\n",
        "            viewMode = if (isNuvioPeriodFolder) FolderViewMode.TABBED_GRID else collection.folderViewMode,\n")

    source = once(source,
        "            tabs = tabs,\n",
        "            tabs = if (isNuvioPeriodFolder) tabs.mapIndexed { index, tab ->\n"
        "                if (index == 0) tab else tab.copy(isLoading = false)\n"
        "            } else tabs,\n")

    source = once(source,
        "            loadTabPage(tabIndex, reset = true)\n        }\n\n        // If no sources, mark as done\n",
        "            if (isNuvioPeriodFolder && sourceIndex > 0) {\n"
        "                // Keep every period tab available, but don't fetch posters\n"
        "                // until the user selects that period.\n"
        "                // Non-selected tabs are marked idle in the initial UI state.\n"
        "                return@forEachIndexed\n"
        "            }\n"
        "            loadTabPage(tabIndex, reset = true)\n"
        "        }\n\n        // If no sources, mark as done\n")

    source = once(source,
        "    fun selectTab(index: Int) {\n"
        "        _uiState.value = _uiState.value.copy(selectedTabIndex = index)\n"
        "    }\n",
        "    fun selectTab(index: Int) {\n"
        "        val state = _uiState.value\n"
        "        val tab = state.tabs.getOrNull(index) ?: return\n"
        "        _uiState.value = state.copy(selectedTabIndex = index)\n"
        "        if (!tab.isAllTab && !tab.hasLoaded && !tab.isLoading && tab.manifestUrl != null) {\n"
        "            loadTabPage(index, reset = true)\n"
        "        }\n"
        "    }\n")

    source = once(source,
        "                    isLoading = true,\n                    isLoadingMore = false,\n                    nextSkip = null,\n                    consecutiveDuplicatePages = 0,\n",
        "                    isLoading = true,\n                    isLoadingMore = false,\n                    hasLoaded = false,\n                    nextSkip = null,\n                    consecutiveDuplicatePages = 0,\n")

    source = once(source,
        "                        isLoading = false,\n                        isLoadingMore = false,\n                        nextSkip = paginationState.nextSkip,\n",
        "                        isLoading = false,\n                        isLoadingMore = false,\n                        hasLoaded = true,\n                        nextSkip = paginationState.nextSkip,\n")

    source = once(source,
        "                        isLoading = false,\n                        isLoadingMore = false,\n                        nextSkip = if (reset) null else tab.nextSkip,\n",
        "                        isLoading = false,\n                        isLoadingMore = false,\n                        hasLoaded = true,\n                        nextSkip = if (reset) null else tab.nextSkip,\n")

    if source == original:
        raise SystemExit("Patch made no changes")
    TARGET.write_text(source, encoding="utf-8")
    print(f"Patched Nuvio Mobile lazy period loading: {TARGET}")
    print("Only the selected period starts fetching on open; other periods fetch on selection.")

if __name__ == "__main__":
    main()
