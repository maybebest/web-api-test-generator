#!/usr/bin/env python3
"""Build the reviewed repository-to-canonical E2E journey mapping.

The output is deliberately source preserving: every repository inventory ID has
exactly one disposition, and no record is matched by a bare cross-source ID.
"""

import json
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
INVENTORY_PATH = ROOT / "packages/web/docs/ai-testing/e2e-test-case-inventory.json"
OUTPUT_PATH = Path(__file__).with_name("journey_mapping.json")

EXTERNAL_IDS = {
    *(f"TC-ACC-{n:03d}" for n in range(1, 6)),
    *(f"TC-SKU-{n:03d}" for n in range(1, 8)),
    *(f"TC-CHS-{n:03d}" for n in range(1, 5)),
    *(f"TC-VAL-{n:03d}" for n in range(1, 5)),
    *(f"TC-CHN-{n:03d}" for n in range(1, 6)),
    *(f"TC-PLN-{n:03d}" for n in range(1, 4)),
    *(f"TC-SEC-{n:03d}" for n in range(1, 8)),
    *(f"TC-PRC-{n:03d}" for n in range(1, 5)),
    *(f"TC-CAL-{n:03d}" for n in range(1, 7)),
    *(f"TC-AIQ-{n:03d}" for n in range(1, 4)),
}

EXTENSION_MEMBERS = {
    "EXT-EXPORT-001": {
        "EXP-001", "EXP-002", "EXP-003", "EXP-004", "EXP-005", "EXP-006", "EXP-008",
    },
    "EXT-AUTOSAVE-001": {"CONV-012"},
    "EXT-DEPENDENCY-001": {"NEG-001", "NEG-002", "OBS-003", "SAI-NEG-005"},
    "EXT-AI-RETRY-001": {"NEG-009", "NEG-010"},
    "EXT-A11Y-001": {"NEG-005", "NEG-006", "SAI-NEG-007"},
    "EXT-RESPONSIVE-001": {"NEG-007", "SAI-NEG-008"},
    "EXT-PERF-001": {"NEG-008"},
}
EXTENSION_BY_MEMBER = {
    member: extension
    for extension, members in EXTENSION_MEMBERS.items()
    for member in members
}

# Granular, speculative, or non-contractual candidates that should not remain
# standalone E2E rows. Some are retained as assertions in an extension journey.
EXPLICIT_MOVE_OUT = {
    "AB-003", "CH-008",
    *(f"CHAT-{n:03d}" for n in range(4, 16)),
    "CONV-005", "CONV-006", "CONV-014",
    "DEL-010",
    "EMPTY-002", "EMPTY-007", "EMPTY-009",
    "ENTRY-003",
    "OBS-001", "OBS-002", "OBS-004", "OBS-005", "OBS-006", "OBS-007",
    "SHELL-001", "SHELL-005", "SHELL-007", "SHELL-010",
    "SUM-012",
    "TC-XJ-022",
}

SPECULATIVE_MOVE_OUT = {
    "CHAT-008", "CHAT-009", "CHAT-010", "CHAT-011", "CHAT-012", "CHAT-013",
    "CONV-006", "CONV-014", "SHELL-007",
}

EXTEND_THEN_MERGE = {
    "TC-ACC-002", "TC-SKU-004", "TC-SKU-005", "TC-SKU-006",
    "TC-VAL-003", "TC-VAL-004", "TC-CHN-005", "TC-PLN-003",
    "TC-SEC-006", "TC-SEC-007", "TC-PRC-003", "TC-PRC-004",
    "TC-CAL-006", "TC-AIQ-001", "TC-AIQ-002", "TC-AIQ-003",
}


def number(repo_id):
    return int(repo_id.rsplit("-", 1)[-1])


def flow_mapping(repo_id):
    if repo_id.startswith("FLOW-MP-004:") or repo_id.startswith("FLOW-MP-005:"):
        return "TC-CHN-001", "timeline boundary regression variant"
    if repo_id.startswith("FLOW-MP-006:"):
        return "TC-CHN-003", "store-boundary regression variant"
    if repo_id.startswith("FLOW-MP-007:") or repo_id.startswith("FLOW-MP-008:"):
        return "TC-CHN-004", "channel-deletion and downstream reconciliation variant"
    if repo_id.startswith("FLOW-MP-009:"):
        suffix = repo_id.split(":", 1)[1]
        if suffix in {"DC-011", "NEG-004"}:
            return "TC-PRC-002", "service-policy costing variant"
        if suffix in {"DC-010", "NEG-003"}:
            return "TC-CAL-006", "budget-led currency calculation variant"
        return "TC-CAL-005", "Trolley, Petrol Pump, or Travel Money oracle variant"
    if repo_id.startswith("FLOW-MP-010:"):
        suffix = repo_id.split(":", 1)[1]
        if suffix == "DC-001":
            return "TC-ACC-004", "cross-cutting valid-plan smoke variant"
        if suffix in {"DC-002", "DC-003", "DC-007", "NEG-001", "NEG-002", "NEG-005"}:
            return "TC-CHN-001", "cross-cutting deadline or duration variant"
        if suffix in {"DC-004", "NEG-003"}:
            return "TC-CHN-003", "cross-cutting store validation variant"
        if suffix in {"DC-005", "NEG-004"}:
            return "TC-AIQ-003", "mixed-batch continuation variant"
        if suffix in {"DC-006", "NEG-006"}:
            return "TC-VAL-004", "configuration preflight or mismatch variant"
        if suffix in {"DC-008", "DC-009"}:
            return "TC-CHN-004", "interleaved deletion and summary reconciliation variant"
        if suffix == "DC-010":
            return "TC-CAL-006", "cross-channel total and currency variant"
    if repo_id.startswith("FLOW-MP-020:") or repo_id.startswith("FLOW-MP-021:"):
        return "TC-ACC-004", "guided-plan save or summary-reflection variant"
    if repo_id.startswith("FLOW-SKU-CHAN:"):
        return "TC-CHS-002", "per-channel Hero edit variant"
    if repo_id.startswith("FLOW-SKU-EDIT:"):
        return "TC-SKU-007", "SKU editor entry-point variant"
    if repo_id.startswith("FLOW-SKU-IND:"):
        return "TC-SKU-003", "Hero indicator and auto-add variant"
    if repo_id.startswith("FLOW-SKU-MAX:"):
        return "TC-VAL-001", "Hero limit boundary variant"
    if repo_id.startswith("FLOW-SKU-PARSE:"):
        return "TC-SKU-006", "combined-prompt parser variant"
    return None


def secondary_mapping(repo_id):
    if repo_id == "SECONDAR-E2E-001" or repo_id in {"JOURNEY-001", "JOURNEY-008"}:
        return "TC-SEC-001", "Secondary Space authority, configuration, or legacy-gate variant"
    if repo_id == "JOURNEY-002":
        return "TC-SEC-004", "mandatory Secondary Space journey"
    if repo_id == "JOURNEY-003":
        return "TC-SEC-005", "optional Secondary Space journey"
    if repo_id == "JOURNEY-004":
        return "TC-SEC-007", "Secondary Space persistence and booking journey"
    if repo_id == "JOURNEY-005":
        return "TC-SEC-003", "mixed-channel Secondary Space journey"
    if repo_id == "JOURNEY-006":
        return "TC-SEC-006", "Secondary Space edit and lock journey"
    if repo_id == "JOURNEY-007":
        return "TC-SEC-002", "Secondary Space role-visibility journey"
    if repo_id.startswith("CHANNELM-E2E-"):
        n = number(repo_id)
        if n in {1, 2, 3, 24}:
            return "TC-SEC-001", "Secondary Space configuration-resolution variant"
        if n in {21, 22, 23}:
            return "TC-SEC-002", "Secondary Space role-visibility variant"
        if n in {16, 18}:
            return "TC-SEC-003", "Secondary Space sequential-batch variant"
        if n in {4, 5, 6}:
            return "TC-SEC-004", "mandatory Secondary Space selection variant"
        if n in {7, 8, 9, 10, 11}:
            return "TC-SEC-005", "optional Secondary Space selection variant"
        if n in {14, 19, 20}:
            return "TC-SEC-006", "Secondary Space edit variant"
        if n in {12, 13, 15, 17}:
            return "TC-SEC-007", "Secondary Space persistence or booking variant"
    return None


def tc_yaml_mapping(repo_id, title):
    t = title.lower()
    if repo_id.startswith("TC-ABL-"):
        n = number(repo_id)
        if n in {14, 15, 29, 31}:
            return "TC-SKU-004", "invalid brand-linked Hero edit variant"
        if n in {24, 25}:
            return "TC-VAL-001", "Hero limit boundary variant"
        if n == 17:
            return "TC-CHS-001", "global-Hero channel default variant"
        if n == 19:
            return "TC-CHS-003", "Hero-union deletion recompute variant"
        if n == 20:
            return "TC-CHS-004", "Hero persistence and reload variant"
        if n in {21, 27}:
            return "TC-SKU-002", "global SKU edit-state lifecycle variant"
        if n in {5, 6}:
            return "TC-CHS-002", "per-channel brand-linked Hero variant"
        if n in {7, 8}:
            return "TC-SKU-006", "single-prompt Hero auto-add variant"
        return "TC-SKU-003", "brand-linked Hero promotion and synchronization variant"

    if repo_id.startswith("TC-CHAN-"):
        n = number(repo_id)
        if n in {10, 11, 12, 14}:
            return "TC-VAL-001", "channel Hero limit boundary variant"
        if n in {13, 15, 29}:
            return "TC-VAL-002", "Hero warning resolution or save-block variant"
        if n in {3, 5, 28}:
            return "TC-CHS-001", "explicit/default per-channel Hero assignment variant"
        if n in {1}:
            return "TC-CHS-002", "per-channel edit-isolation variant"
        if n in {7, 8, 9, 25, 27}:
            return "TC-CHS-003", "campaign-Hero union recompute variant"
        if n in {22, 26}:
            return "TC-SKU-006", "single-prompt channel SKU variant"
        if n in {21, 24}:
            return "TC-SKU-003", "Hero auto-add and synchronization variant"
        return "TC-CHS-002", "per-channel Hero assignment variant"

    if repo_id.startswith("TC-CHL-"):
        n = number(repo_id)
        if n in {1, 2}:
            return "TC-CHS-001", "channel Hero default/prepopulation variant"
        if n in {6, 8, 10}:
            return "TC-CHS-003", "campaign-Hero union recompute variant"
        if n == 14:
            return "TC-CHS-004", "per-channel Hero persistence/render variant"
        if n in {16, 25, 28}:
            return "TC-VAL-001", "channel Hero limit boundary variant"
        return "TC-CHS-002", "per-channel edit-isolation variant"

    if repo_id.startswith("TC-EDIT-") or repo_id.startswith("TC-ESL-"):
        n = number(repo_id)
        if any(word in t for word in ("maximum", "minimum", "max+1", "at-max")):
            return "TC-VAL-001", "SKU-editor limit variant"
        if "indicator" in t or "auto-add" in t:
            return "TC-SKU-003", "SKU-editor Hero synchronization assertion"
        return "TC-SKU-007", "SKU-editor entry-point variant"

    if repo_id.startswith("TC-GHM-"):
        n = number(repo_id)
        if n == 33:
            return "TC-VAL-001", "global-versus-channel limit boundary variant"
        if n == 20:
            return "TC-CHS-001", "global-Hero channel prepopulation variant"
        if n in {16, 17}:
            return "TC-SKU-002", "global SKU edit-state variant"
        if n in {19, 34}:
            return "TC-SKU-003", "global Hero synchronization or auto-add variant"
        return "TC-SKU-001", "global Measurement/Hero selection variant"

    if repo_id.startswith("TC-IND-"):
        n = number(repo_id)
        if n in {16, 17, 18, 20, 21}:
            return "TC-VAL-001", "Hero limit boundary variant"
        if n == 19:
            return "TC-VAL-002", "Hero warning resolution variant"
        if n in {24}:
            return "TC-CHS-001", "default channel-Hero inheritance variant"
        if n in {13, 14, 15, 33}:
            return "TC-CHS-003", "campaign-Hero union recompute variant"
        if n == 6:
            return "TC-SKU-006", "single-prompt Hero parsing variant"
        return "TC-SKU-003", "Hero indicator and auto-add variant"

    if repo_id.startswith("TC-MAX-"):
        if any(word in t for word in ("warning clears", "unblocks", "booking explicitly", "whole plan", "mixed-max plan")):
            return "TC-VAL-002", "Hero warning save/block lifecycle variant"
        return "TC-VAL-001", "independent Hero minimum/maximum variant"

    if repo_id.startswith("TC-PRM-"):
        return "TC-SKU-006", "single-prompt parser variant"

    if repo_id.startswith("TC-SPI-"):
        n = number(repo_id)
        if n == 11 or "invalid" in t or "malformed" in t:
            return "TC-SKU-005", "invalid catalogue identifier variant"
        if n == 22:
            return "TC-VAL-001", "single-prompt Hero limit variant"
        if n in {15, 16, 17}:
            return "TC-SKU-007", "single-prompt editor-entry variant"
        if n == 14:
            return "TC-CHS-001", "parsed global Hero channel-default variant"
        return "TC-SKU-006", "combined SKU prompt variant"

    if repo_id.startswith("TC-VAL-"):
        n = number(repo_id)
        if n in {1, 2, 4}:
            return "TC-CHS-001", "channel SKU propagation variant"
        if n == 5:
            return "TC-SKU-003", "Hero auto-add propagation variant"
        if n == 18:
            return "TC-VAL-001", "post-assignment limit recompute variant"
        return "TC-VAL-001", "Hero boundary validation variant"

    if repo_id.startswith("TC-XJ-"):
        n = number(repo_id)
        if n in {1, 17}:
            return "TC-CHS-001", "global-to-channel assignment journey"
        if n in {2, 8, 9, 23, 25}:
            return "TC-CHS-003", "multi-edit/delete Hero-union journey"
        if n in {3, 13, 18}:
            return "TC-SKU-007", "SKU editor journey"
        if n in {4, 19}:
            return "TC-SKU-006", "single-prompt journey"
        if n in {15, 16, 24}:
            return "TC-VAL-001", "Hero boundary/recovery journey"
        if n == 20:
            return "TC-SKU-002", "global SKU edit-lock journey"
        if n == 26:
            return "TC-CHS-002", "global-versus-channel edit-state journey"
        return "TC-SKU-003", "Hero auto-add or synchronization journey"
    return None


def module_mapping(repo_id, title):
    t = title.lower()
    if repo_id.startswith("AB-"):
        n = number(repo_id)
        if n == 2:
            return "TC-ACC-004", "advertiser/brand selection variant"
        if n in {1, 4}:
            return "TC-AIQ-002", "unknown or unresolved entity variant"
        if n in {5, 6}:
            return "TC-AIQ-003", "entity dependency or correction variant"
        if n == 7:
            return "TC-AIQ-001", "locale/special-character entity variant"

    if repo_id.startswith("AI-"):
        n = number(repo_id)
        if n in {1, 10}:
            return "TC-AIQ-001", "prompt normalization variant"
        if n in {2, 3, 5, 6}:
            return "TC-AIQ-003", "batch or out-of-order data variant"
        if n in {4, 9}:
            return "TC-AIQ-002", "missing or ambiguous entity variant"
        if n in {7, 8}:
            return "TC-SKU-006", "SKU declaration parsing variant"

    if repo_id.startswith("AUTH-"):
        n = number(repo_id)
        if n in {1, 4}:
            return "TC-ACC-001", "authenticated entry variant"
        if n in {2, 3, 6}:
            return "TC-ACC-002", "session or authorization negative variant"
        if n == 5:
            return "TC-ACC-003", "authenticated reload/recovery variant"

    if repo_id.startswith("CH-"):
        n = number(repo_id)
        if n in {1, 3, 4, 5}:
            return "TC-ACC-004", "channel-group happy-path variant"
        if n in {2, 10}:
            return "TC-VAL-003", "channel eligibility variant"
        if n == 6:
            return "TC-AIQ-003", "duplicate channel deduplication variant"
        if n == 7:
            return "TC-AIQ-002", "ambiguous channel entity variant"
        if n == 9:
            return "TC-CHS-002", "channel editor identity variant"

    if repo_id.startswith("CHAT-"):
        return "TC-ACC-001", "planning entry/starter-prompt assertion"

    if repo_id.startswith("CONV-"):
        n = number(repo_id)
        if n in {1, 2, 3, 11, 13}:
            return "TC-ACC-003", "conversation persistence/recovery variant"
        if n in {7}:
            return "TC-ACC-001", "isolated new-conversation variant"
        if n in {8, 9, 10}:
            return "TC-ACC-005", "parallel conversation isolation variant"
        if n == 4:
            return "TC-ACC-001", "empty conversation-history assertion"

    if repo_id.startswith("DEL-"):
        return "TC-CHN-004", "channel deletion and reconciliation variant"

    if repo_id.startswith("EMPTY-"):
        n = number(repo_id)
        if n == 1:
            return "TC-ACC-001", "isolated empty-state assertion"
        if n in {3, 4, 5}:
            return "TC-PLN-001", "pre-save action-gating assertion"
        if n == 6:
            return "TC-ACC-004", "progressive guided-plan state assertion"
        if n == 8:
            return "TC-ACC-003", "early-draft naming assertion"

    if repo_id.startswith("ENTRY-"):
        n = number(repo_id)
        if n in {1, 2}:
            return "TC-ACC-001", "planning entry variant"
        if n in {4, 5, 7}:
            return "TC-AIQ-002", "empty, unsupported, or ambiguous prompt variant"
        if n == 6:
            return "TC-AIQ-003", "missing-data follow-up variant"
        if n == 8:
            return "TC-AIQ-001", "large prompt normalization variant"

    if repo_id.startswith("EXP-"):
        return "TC-PLN-001", "saved-plan Pollen handoff or pre-save gating assertion"

    if repo_id.startswith("NEG-"):
        n = number(repo_id)
        if n == 3:
            return "TC-VAL-004", "stale configuration variant"
        if n == 4:
            return "TC-ACC-003", "browser navigation recovery variant"

    if repo_id.startswith("OBJ-"):
        n = number(repo_id)
        if n == 1:
            return "TC-ACC-004", "objective entry variant"
        if n in {2, 3}:
            return "TC-AIQ-003", "objective follow-up or correction variant"
        if n == 4:
            return "TC-AIQ-002", "unsupported objective variant"
        if n == 5:
            return "TC-ACC-003", "early-draft naming variant"

    if repo_id == "OBS-008":
        return "TC-ACC-002", "redacted logging/audit assertion"

    if repo_id.startswith("RATE-"):
        n = number(repo_id)
        if n == 13:
            return "TC-PRC-002", "service-policy pricing variant"
        if n == 14:
            return "TC-PRC-004", "published pricing configuration refresh variant"
        if n in {3, 7, 8, 9, 10, 11, 12}:
            return "TC-PRC-001", "pricing-model routing variant"
        if n == 4:
            return "TC-CAL-006", "invalid currency input variant"
        return "TC-PRC-001", "pricing-model or rate variant"

    if repo_id.startswith("REST-"):
        return "TC-VAL-003", "HFSS/category eligibility variant"

    if repo_id.startswith("SAVE-"):
        n = number(repo_id)
        if n in {1, 2, 3, 4, 9}:
            return "TC-PLN-001", "final save/handoff variant"
        if n == 5:
            return "TC-PLN-002", "discard variant"
        if n == 6:
            return "TC-ACC-003", "pre-save reload recovery variant"
        if n in {7, 8}:
            return "TC-PLN-003", "idempotent/retry-safe save variant"

    if repo_id.startswith("SHELL-"):
        n = number(repo_id)
        if n in {2, 3, 4, 6}:
            return "TC-ACC-003", "navigation-away and draft-recovery variant"
        if n in {8, 9}:
            return "TC-ACC-002", "protected navigation/logout authorization variant"

    if repo_id.startswith("SKU-H-"):
        n = number(repo_id)
        if n in {1, 2}:
            return "TC-SKU-001", "global Hero selection variant"
        if n == 3:
            return "TC-CHS-001", "global-Hero channel default variant"
        if n == 4:
            return "TC-CHS-002", "per-channel Hero edit variant"
        if n in {5, 9, 10}:
            return "TC-SKU-003" if n == 5 else "TC-CHS-003", "Hero synchronization variant"
        if n == 6:
            return "TC-SKU-006", "combined SKU prompt variant"
        if n in {7, 8}:
            return "TC-SKU-007", "Hero editor entry-point variant"
        if n in {11, 12, 13, 14}:
            return "TC-VAL-001", "Hero limit variant"

    if repo_id.startswith("SKU-M-"):
        n = number(repo_id)
        if n in {1, 2, 3, 4}:
            return "TC-SKU-001", "Measurement SKU selection variant"
        if n in {5, 6, 7, 8}:
            return "TC-SKU-005", "catalogue boundary or invalid identifier variant"
        if n in {9, 10}:
            return "TC-SKU-007", "Measurement editor entry-point variant"
        if n == 11:
            return "TC-SKU-002", "post-channel SKU edit-lock variant"
        if n == 12:
            return "TC-SKU-001", "Measurement SKU rendering assertion"

    if repo_id.startswith("STORE-"):
        return "TC-CHN-003", "store-count validation variant"

    if repo_id.startswith("SUM-"):
        n = number(repo_id)
        if n in {1, 2, 3, 4}:
            return "TC-ACC-004", "guided-plan summary reflection assertion"
        if n in {5, 6}:
            return "TC-AIQ-003", "summary entity/objective correction variant"
        if n in {7, 8}:
            return "TC-SKU-007", "summary SKU editor variant"
        if n in {9, 10, 11}:
            return "TC-CHS-002", "summary channel editor variant"

    if repo_id.startswith("TIME-"):
        n = number(repo_id)
        if n == 11:
            return "TC-CHN-002", "saved-channel date revalidation variant"
        return "TC-CHN-001", "timeline boundary variant"
    return None


def qa_mapping(repo_id):
    if repo_id.startswith("SAI-AUTH-"):
        return ("TC-ACC-001", "authentication entry variant") if number(repo_id) == 1 else ("TC-ACC-002", "authorization/session variant")
    if repo_id.startswith("SAI-DEL-"):
        return "TC-CHN-004", "channel deletion and reconciliation variant"
    if repo_id.startswith("SAI-LIM-"):
        return "TC-VAL-001" if number(repo_id) != 2 else "TC-VAL-002", "Hero limit variant"
    if repo_id.startswith("SAI-MP-"):
        n = number(repo_id)
        if n in {1, 2}:
            return "TC-ACC-004", "media-plan guided-flow variant"
        if n in {3, 4, 5, 6}:
            return "TC-AIQ-003", "missing/mixed channel batch variant"
    if repo_id.startswith("SAI-NEG-"):
        n = number(repo_id)
        if n == 1:
            return "TC-SKU-005", "invalid SKU identifier variant"
        if n == 2:
            return "TC-SKU-006", "duplicate SKU prompt variant"
        if n == 3:
            return "TC-AIQ-002", "ambiguous prompt variant"
        if n == 4:
            return "TC-VAL-004", "stale configuration variant"
        if n == 6:
            return "TC-ACC-003", "draft refresh/recovery variant"
    if repo_id.startswith("SAI-RATE-"):
        return ("TC-PRC-002", "service-policy pricing variant") if number(repo_id) == 4 else ("TC-PRC-001", "pricing-model routing variant")
    if repo_id.startswith("SAI-REST-"):
        return "TC-VAL-003", "HFSS/category eligibility variant"
    if repo_id.startswith("SAI-SAVE-"):
        return ("TC-PLN-001", "saved-plan persistence variant") if number(repo_id) == 1 else ("TC-PLN-002", "discard variant")
    if repo_id.startswith("SAI-SKU-"):
        n = number(repo_id)
        if n in {1, 2}:
            return "TC-SKU-001", "global Measurement/Hero selection variant"
        if n == 3:
            return "TC-CHS-001", "global-Hero channel default variant"
        if n == 4:
            return "TC-CHS-002", "per-channel Hero edit variant"
        if n in {5}:
            return "TC-SKU-003", "brand-linked Hero auto-add variant"
        if n == 6:
            return "TC-SKU-006", "combined SKU prompt variant"
        if n in {7, 8, 9}:
            return "TC-SKU-007", "SKU editor entry-point variant"
        if n in {10, 11}:
            return "TC-CHS-003", "campaign-Hero union recompute variant"
    if repo_id.startswith("SAI-SS-"):
        n = number(repo_id)
        if n in {1, 2, 17, 18, 19}:
            return "TC-SEC-001", "Secondary Space authority/configuration variant"
        if n in {14, 15}:
            return "TC-SEC-002", "Secondary Space role-visibility variant"
        if n == 16:
            return "TC-SEC-003", "Secondary Space mixed-channel variant"
        if n in {3, 4, 5, 6, 7}:
            return "TC-SEC-004", "mandatory Secondary Space variant"
        if n in {8, 9, 10}:
            return "TC-SEC-005", "optional Secondary Space variant"
        if n in {11, 12}:
            return "TC-SEC-006", "Secondary Space edit/lock variant"
        if n == 13:
            return "TC-SEC-007", "Secondary Space persistence variant"
    if repo_id.startswith("SAI-STORE-"):
        return "TC-CHN-003", "store-count/pricing input variant"
    if repo_id.startswith("SAI-TIME-"):
        return "TC-CHN-001", "timeline boundary variant"
    return None


def canonical_mapping(case):
    repo_id = case["id"]
    title = case["title"]
    for mapper in (flow_mapping, secondary_mapping):
        result = mapper(repo_id)
        if result:
            return result
    result = tc_yaml_mapping(repo_id, title)
    if result:
        return result
    result = module_mapping(repo_id, title)
    if result:
        return result
    result = qa_mapping(repo_id)
    if result:
        return result
    return None


def disposition(case):
    repo_id = case["id"]
    declared = case["declaredType"]
    blocked_decision = case["automation"]["status"] == "blocked-product-decision"

    if declared in {"UI", "Integration", "Unit"}:
        role = "ambiguous" if blocked_decision else "lower-level"
        return "MOVE_OUT_OF_E2E", "move-out", role, (
            f"Source declares this record as {declared}; retain it in the appropriate lower-level suite, not as a standalone E2E."
        )

    if repo_id in EXPLICIT_MOVE_OUT:
        if repo_id == "TC-XJ-022":
            return "MOVE_OUT_OF_E2E", "move-out", "obsolete", (
                "Exact conversation-copy assertion is brittle and superseded by semantic/structured AI quality oracles."
            )
        if repo_id in SPECULATIVE_MOVE_OUT:
            return "MOVE_OUT_OF_E2E", "move-out", "ambiguous", (
                "Feature or contract is conditional ('if available'/'if in scope'); restore only after scope and oracle approval."
            )
        return "MOVE_OUT_OF_E2E", "move-out", "lower-level", (
            "Granular control, visual, telemetry, or shell assertion; preserve below E2E or attach to a canonical journey."
        )

    if repo_id in EXTENSION_BY_MEMBER:
        target = EXTENSION_BY_MEMBER[repo_id]
        return target, "extension", "variant", (
            "Unique repository risk absent from the 48 external journeys; consolidate under the named extension journey."
        )

    mapped = canonical_mapping(case)
    if not mapped:
        raise ValueError(f"No canonical mapping for {repo_id}: {case['title']}")
    target, detail = mapped
    if target not in EXTERNAL_IDS:
        raise ValueError(f"Invalid external target {target} for {repo_id}")
    role = "ambiguous" if blocked_decision else ("assertion" if declared == "e2e-candidate" else "variant")
    extension_note = " Extend the canonical case before removing this row." if target in EXTEND_THEN_MERGE else ""
    return target, "external", role, f"{detail}; preserve the source ID as traceability.{extension_note}"


def main():
    inventory = json.loads(INVENTORY_PATH.read_text())
    cases = inventory["cases"]
    mappings = []
    for case in cases:
        canonical_id, target_kind, role, reason = disposition(case)
        mappings.append({
            "repoId": case["id"],
            "canonicalId": canonical_id,
            "targetKind": target_kind,
            "role": role,
            "reason": reason,
            "sourceDeclaredType": case["declaredType"],
            "sourceKind": case["kind"],
            "area": case["area"],
            "title": case["title"],
        })

    if len(cases) != 752 or len(mappings) != 752:
        raise ValueError(f"Expected 752 source records, got {len(cases)} / {len(mappings)}")
    repo_ids = [item["repoId"] for item in mappings]
    if len(set(repo_ids)) != 752:
        raise ValueError("Repository IDs are not unique")

    kind_counts = Counter(item["targetKind"] for item in mappings)
    expected_counts = {"external": 548, "extension": 20, "move-out": 184}
    if dict(kind_counts) != expected_counts:
        raise ValueError(f"Disposition counts changed: {dict(kind_counts)} != {expected_counts}")

    blocked_ids = {
        case["id"] for case in cases
        if case["automation"]["status"] == "blocked-product-decision"
    }
    ambiguous_blocked = {
        item["repoId"] for item in mappings
        if item["role"] == "ambiguous" and item["repoId"] in blocked_ids
    }
    if len(blocked_ids) != 25 or ambiguous_blocked != blocked_ids:
        raise ValueError("All 25 blocked-product-decision records must remain explicitly ambiguous")

    canonical_counts = Counter(item["canonicalId"] for item in mappings)
    role_counts = Counter(item["role"] for item in mappings)
    external_coverage = sorted(EXTERNAL_IDS - {item["canonicalId"] for item in mappings})
    output = {
        "schemaVersion": 1,
        "source": {
            "repositoryInventory": str(INVENTORY_PATH),
            "externalJourneyWorkbook": "/Users/maybebest/Documents/Projects/sains/sains_docs/outputs/pollen_e2e_generated_20260713/Nectar360_Pollen_E2E_Journey_Test_Suite.xlsx",
            "notes": [
                "Cross-source mapping is semantic: external E2E-* source-case IDs have no exact repository-ID match.",
                "TC-VAL-001..004 collide across sources and must remain namespaced; canonicalId refers to the external journey.",
                "MOVE_OUT_OF_E2E means remove as a standalone E2E row, not erase the underlying lower-level assertion.",
                "Sixteen partial-overlap external journeys must be extended with mapped variants/assertions before source-row removal.",
            ],
        },
        "canonicalSets": {
            "external": sorted(EXTERNAL_IDS),
            "extensions": sorted(EXTENSION_MEMBERS),
            "moveOutSentinel": "MOVE_OUT_OF_E2E",
            "extendThenMerge": sorted(EXTEND_THEN_MERGE),
        },
        "summary": {
            "repositoryRecords": len(mappings),
            "dispositionCounts": expected_counts,
            "roleCounts": dict(sorted(role_counts.items())),
            "canonicalCounts": dict(sorted(canonical_counts.items())),
            "blockedProductDecisionRecords": len(blocked_ids),
            "externalCanonicalIdsWithoutRepositoryRows": external_coverage,
            "recommendedCanonicalJourneyCount": 55,
        },
        "mappings": mappings,
    }
    OUTPUT_PATH.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
