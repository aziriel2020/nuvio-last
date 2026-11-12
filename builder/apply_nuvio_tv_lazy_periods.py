#!/usr/bin/env python3
"""Apply an isolated, fail-closed NuvioTV lazy-load fix for large calendar folders.

Targets exactly the upstream NuvioTV source at the pinned revision.
Does not alter shared collection JSON, addon manifests, IDs or date windows.
The beta uses a separate Android package and Android debug signing.
"""
import sys
from pathlib import Path

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("NuvioTV")
target = root / "app/src/main/java/com/nuvio/tv/ui/screens/collection/FolderDetailViewModel.kt"
gradle = root / "app/build.gradle.kts"

def replace_once(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"Unexpected upstream source for {label}: expected once, found {count}")
    return source.replace(old, new, 1)

def main():
    s = target.read_text(encoding="utf-8")
    before = s

    s = replace_once(s,
        "    val isAllTab: Boolean = false\n)",
        "    val isAllTab: Boolean = false,\n    // Only completed tabs are kept in memory; unopened calendar periods are idle.\n"
        "    val hasLoaded: Boolean = false\n)",
        "folder tab state")

    s = replace_once(s,
        "            val showAll = (collection?.showAllTab ?: true) && folder.sources.size >= 2\n\n"
        "            val viewMode = collection?.viewMode ?: FolderViewMode.TABBED_GRID\n",
        "            // Shield legacy FOLLOW_LAYOUT renders every period and immediately fetches\n"
        "            // every poster. Opt in only for large, known Nuvio calendar folders.\n"
        "            val isNuvioPeriodFolder = folder.sources.size >= 8 && folder.sources.all { source ->\n"
        "                val addon = source as? AddonCatalogCollectionSource\n"
        "                addon != null && (\n"
        "                    addon.addonId.startsWith(\"com.nuvio.calendar.archives.\") ||\n"
        "                    addon.addonId == \"com.nuvio.movies.france.world.v1\" ||\n"
        "                    addon.addonId == \"com.nuvio.series.france.liveaction.v2\" ||\n"
        "                    addon.addonId == \"com.nuvio.series.world.liveaction\"\n"
        "                )\n"
        "            }\n"
        "            val showAll = (collection?.showAllTab ?: true) && folder.sources.size >= 2 && !isNuvioPeriodFolder\n\n"
        "            val viewMode = if (isNuvioPeriodFolder) FolderViewMode.TABBED_GRID\n"
        "                else collection?.viewMode ?: FolderViewMode.TABBED_GRID\n",
        "calendar-only mode")

    s = replace_once(s,
        "            val sourceTabs = folder.sources.map { source ->",
        "            val sourceTabs = folder.sources.mapIndexed { sourceIndex, source ->",
        "indexed period tabs")

    s = replace_once(s,
        "                FolderTab(label = name, typeLabel = typeLabel, rawType = rawType, source = source, catalogRow = placeholderRow, isLoading = true)",
        "                FolderTab(label = name, typeLabel = typeLabel, rawType = rawType, source = source,\n"
        "                    catalogRow = placeholderRow, isLoading = !isNuvioPeriodFolder || sourceIndex == 0)",
        "idle initial tabs")

    s = replace_once(s,
        "            folder.sources.forEachIndexed { index, source ->\n"
        "                loadSourceForTab(index + tabOffset, source)\n"
        "            }",
        "            folder.sources.forEachIndexed { index, source ->\n"
        "                if (!isNuvioPeriodFolder || index == 0) {\n"
        "                    loadSourceForTab(index + tabOffset, source)\n"
        "                }\n"
        "            }",
        "first period only")

    s = replace_once(s,
        "    fun selectTab(index: Int) {\n"
        "        _uiState.update { it.copy(selectedTabIndex = index) }\n"
        "    }",
        "    fun selectTab(index: Int) {\n"
        "        val tab = _uiState.value.tabs.getOrNull(index) ?: return\n"
        "        _uiState.update { it.copy(selectedTabIndex = index) }\n"
        "        if (tab.isAllTab || tab.isLoading || tab.hasLoaded || tab.source == null) return\n"
        "        // Transition to loading synchronously: repeated remote events cannot\n"
        "        // start duplicate fetches before the coroutine starts.\n"
        "        _uiState.update { state ->\n"
        "            val tabs = state.tabs.toMutableList()\n"
        "            if (index in tabs.indices) {\n"
        "                tabs[index] = tabs[index].copy(isLoading = true, error = null)\n"
        "            }\n"
        "            state.copy(tabs = tabs)\n"
        "        }\n"
        "        loadSourceForTab(index, tab.source)\n"
        "    }",
        "lazy selected tab")

    s = replace_once(s,
        "                                    catalogRow = result.data.filteredForRelease(state.hideUnreleasedContent),\n"
        "                                    isLoading = false\n",
        "                                    catalogRow = result.data.filteredForRelease(state.hideUnreleasedContent),\n"
        "                                    isLoading = false,\n"
        "                                    hasLoaded = true\n",
        "record successful period")

    if "isNuvioPeriodFolder" not in s or before == s:
        raise RuntimeError("Failed to activate calendar-only lazy selection")
    target.write_text(s, encoding="utf-8")

    # Android TV debug variants in upstream use the production signing key.
    # The beta must be separate and signed by the standard Android debug keystore.
    g = gradle.read_text(encoding="utf-8")
    g = replace_once(g,
        '        debug {\n            signingConfig = signingConfigs.getByName("release")\n',
        '        debug {\n            applicationIdSuffix = ".calendarbeta"\n'
        '            signingConfig = signingConfigs.getByName("debug")\n',
        "side-by-side debug package and signature")
    gradle.write_text(g, encoding="utf-8")
    print("Patched TV calendar folders: first period at open, others only on selection")
    print("Non-calendar folder behaviors unchanged, original data preserved")
    print("Test app package: com.nuvio.tv.calendarbeta (debug signing, not a production upgrade)")

if __name__ == "__main__":
    main()
