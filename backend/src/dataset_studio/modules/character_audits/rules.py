"""Pure inventory, evidence policy, and per-image change planning.

Adapted workflow: BooruDatasetTagManagerPlus, revision
682a842fdab63baacda5f0b3f3727f379f3b66ed (MIT; see UPSTREAM_LICENSE).
Shared-image conflicts require an explicit human decision in this implementation.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from collections.abc import Mapping, Sequence
from pathlib import PurePosixPath

from dataset_studio.modules.annotations.models import AnnotationTag
from dataset_studio.modules.character_audits.models import (
    ApplyPreview,
    AssetChange,
    AssetSnapshot,
    AuditOperation,
    Category,
    CharacterProfile,
    ConflictResolution,
    InventoryTag,
    MembershipPreview,
    ProfileReview,
    TagConflict,
    TagDecision,
)
from dataset_studio.modules.character_audits.vocabulary import SemanticTag
from dataset_studio.modules.tag_dictionaries.models import normalize_tag_key

MUTABLE = frozenset(
    {"hair", "eyes", "face", "body", "clothing", "footwear", "legwear", "accessory"}
)
COLORS = frozenset(
    {
        "red",
        "blue",
        "green",
        "yellow",
        "purple",
        "pink",
        "brown",
        "black",
        "grey",
        "gray",
        "orange",
        "white",
        "gold",
        "blonde",
        "blond",
        "silver",
    }
)
GENERIC_HAIR = frozenset({"colored_hair", "multicolored_hair", "two-tone_hair", "gradient_hair"})


class AuditPolicyError(ValueError):
    """An audit answer or manual edit violates an evidence or protection rule."""


def in_directory(path: str, directory: str) -> bool:
    parent = PurePosixPath(path).parent
    root = PurePosixPath(directory or ".")
    return parent == root or root in parent.parents


def membership(asset: AssetSnapshot, profiles: Sequence[CharacterProfile]) -> tuple[int, ...]:
    keys = {normalize_tag_key(tag.name) for tag in asset.tags}
    return tuple(
        index
        for index, profile in enumerate(profiles)
        if (profile.membership == "trigger" and normalize_tag_key(profile.trigger) in keys)
        or (
            profile.membership == "directory"
            and in_directory(asset.relative_path, profile.directory or "")
        )
    )


def membership_preview(
    assets: Sequence[AssetSnapshot],
    profiles: Sequence[CharacterProfile],
) -> MembershipPreview:
    members = [membership(asset, profiles) for asset in assets]
    return MembershipPreview(
        total=len(assets),
        member_counts=[sum(i in ids for ids in members) for i in range(len(profiles))],
        shared_count=sum(len(ids) > 1 for ids in members),
        unattributed_count=sum(not ids for ids in members),
        missing_tags_count=sum(not asset.usable for asset in assets),
        candidate_count=sum(asset.candidate_count for asset in assets),
    )


def classify(tag: str, semantic: SemanticTag | None) -> Category:
    key = normalize_tag_key(tag)
    words = set(key.split("_"))
    if semantic and semantic.category in {"character", "copyright", "artist", "rating", "meta"}:
        return "identity" if semantic.category == "character" else "other"
    protected_groups: dict[str, Category] = {
        "动作": "action",
        "构图": "composition",
        "表情": "expression",
        "背景": "scene",
        "场景": "scene",
        "姿势": "pose",
        "物品": "object",
        "画风": "quality",
        "人数": "composition",
        "cosplay": "other",
        "作品": "other",
        "画师": "other",
        "动物": "other",
        "食物": "other",
    }
    if semantic and semantic.group in protected_groups:
        return protected_groups[semantic.group]
    if words & {"holding", "grabbing", "pulling", "adjusting", "touching", "looking"}:
        return "action"
    if words & {"hair", "bangs", "ponytail", "twintails", "braid", "braids", "ahoge"}:
        if words & {"ornament", "accessory", "ribbon", "bow", "flower", "clip"}:
            return "accessory"
        return "hair"
    if "eyes" in words and words & {
        "red",
        "blue",
        "green",
        "yellow",
        "purple",
        "pink",
        "brown",
        "black",
        "grey",
        "gray",
        "orange",
        "white",
        "gold",
        "heterochromia",
    }:
        return "eyes"
    if key in {"heterochromia", "pointy_ears", "freckles", "mole", "fangs"}:
        return "eyes" if key == "heterochromia" else "face"
    if words & {"boots", "shoes", "heels", "sandals", "slippers", "sneakers"}:
        return "footwear"
    if words & {"thighhighs", "pantyhose", "socks", "stockings", "legwear"}:
        return "legwear"
    if words & {
        "dress",
        "shirt",
        "jacket",
        "coat",
        "skirt",
        "shorts",
        "pants",
        "bikini",
        "swimsuit",
        "leotard",
        "cape",
        "apron",
        "sweater",
        "kimono",
        "uniform",
    }:
        return "clothing"
    if words & {
        "hat",
        "headwear",
        "hairband",
        "hairclip",
        "hairpin",
        "earrings",
        "necklace",
        "choker",
        "bracelet",
        "gloves",
        "ribbon",
        "bow",
        "jewelry",
        "halo",
        "beret",
    }:
        return "accessory"
    if words & {"tail", "horns", "wings", "breasts"}:
        return "body"
    if semantic:
        groups: dict[str, Category] = {
            "身体": "body",
            "服装": "clothing",
            "服饰": "clothing",
            "饰品": "accessory",
            "鞋": "footwear",
            "鞋袜": "legwear",
            "头发": "hair",
            "眼睛": "eyes",
            "表情": "expression",
            "动作": "action",
            "姿势": "pose",
            "场景": "scene",
            "构图": "composition",
            "物品": "object",
            "背景": "scene",
        }
        return groups.get(semantic.group, "other")
    return "other"


def build_inventory(
    assets: Sequence[AssetSnapshot],
    profiles: Sequence[CharacterProfile],
    index: int,
    semantics: Mapping[str, SemanticTag],
    minimum_count: int,
) -> ProfileReview:
    names: dict[str, str] = {}
    counts: Counter[str] = Counter()
    for asset in assets:
        if index not in membership(asset, profiles):
            continue
        keys = set()
        for tag in asset.tags:
            key = normalize_tag_key(tag.name)
            names.setdefault(key, tag.name)
            keys.add(key)
        counts.update(keys)
    categories = {key: classify(key, semantics.get(key)) for key in counts}
    triggers = {normalize_tag_key(profile.trigger) for profile in profiles}
    categories = {
        key: "identity" if key in triggers else category for key, category in categories.items()
    }
    clusters: dict[str, int] = {}
    remaining = set(counts)
    while remaining:
        first = min(remaining)
        connected = {first}
        frontier = {first}
        while frontier:
            key = frontier.pop()
            semantic = semantics.get(key)
            neighbors = set(semantic.related + semantic.parents) if semantic else set()
            for candidate in remaining - connected:
                reverse = semantics.get(candidate)
                related = candidate in neighbors or bool(reverse and key in reverse.parents)
                if (
                    related
                    and categories[key] == categories[candidate]
                    and categories[key] in MUTABLE
                ):
                    frontier.add(candidate)
                    connected.add(candidate)
        remaining -= connected
        if len(connected) > 1:
            cluster = len(set(clusters.values())) + 1
            clusters.update(dict.fromkeys(connected, cluster))
    items = [
        InventoryTag(
            tag=names[key], count=counts[key], category=categories[key], cluster=clusters.get(key)
        )
        for key in sorted(counts, key=lambda key: (-counts[key], key))
    ]
    return ProfileReview(
        profile_index=index,
        inventory=[item for item in items if item.count >= minimum_count],
        excluded=[item for item in items if item.count < minimum_count],
        initial=[],
        suggested=[],
        decisions=[],
        completed_stages=[],
        prompt="",
        confirmed=False,
    )


def validate_decisions(
    items: Sequence[TagDecision],
    inventory: Sequence[InventoryTag],
    triggers: Sequence[str],
    prompt_trigger: str,
) -> None:
    expected = {item.tag: item for item in inventory}
    if len(items) != len(expected) or {item.tag for item in items} != set(expected):
        raise AuditPolicyError("审查结果必须恰好覆盖每个输入标签一次，不可遗漏、重复或添加标签。")
    locked = {normalize_tag_key(trigger) for trigger in triggers}
    for item in items:
        source = expected[item.tag]
        key = normalize_tag_key(item.tag)
        if item.category != source.category:
            raise AuditPolicyError(f"{item.tag}: 不允许模型或人工修改输入标签的保护类别。")
        if not item.reason.strip() or item.reason.strip().casefold() in {
            "core tag",
            "required tag",
            "standard tag",
        }:
            raise AuditPolicyError(f"{item.tag}: 请填写具体视觉证据或保留原因。")
        if item.decision in {"delete", "replace"} and (
            item.category not in MUTABLE or key in locked
        ):
            raise AuditPolicyError(f"{item.tag}: 触发词和非角色外观类别不允许删除或替换。")
        if key in locked and item.decision != "keep":
            raise AuditPolicyError(f"{item.tag}: 角色触发词必须保留。")
        if (
            item.include_in_prompt
            and item.category == "identity"
            and key != normalize_tag_key(prompt_trigger)
        ):
            raise AuditPolicyError(f"{item.tag}: 其他角色的身份不能进入当前角色提示词。")
        if item.decision == "replace":
            replacement = item.replacement
            if (
                not replacement
                or not replacement.strip()
                or any(c in replacement for c in ",\r\n\x00")
            ):
                raise AuditPolicyError(f"{item.tag}: 替换目标必须是一个非空标签。")
            target = normalize_tag_key(replacement)
            if target == key or target in locked:
                raise AuditPolicyError(f"{item.tag}: 替换不能等于原词或角色触发词。")
            if key not in GENERIC_HAIR and target in GENERIC_HAIR:
                raise AuditPolicyError(f"{item.tag}: 不允许用泛化发色丢弃具体颜色。")
            if (
                item.category == "hair"
                and set(key.split("_")) & COLORS
                and not set(target.split("_")) & COLORS
            ):
                raise AuditPolicyError(f"{item.tag}: 替换目标不能丢弃具体发色。")
            if classify(target, None) != item.category:
                raise AuditPolicyError(f"{item.tag}: 替换目标必须属于相同的已识别角色部位。")
        elif item.replacement is not None:
            raise AuditPolicyError(f"{item.tag}: 只有替换决定可以填写替换词。")
        if item.include_in_prompt and (
            item.decision in {"delete", "uncertain"} or item.category not in MUTABLE | {"identity"}
        ):
            raise AuditPolicyError(f"{item.tag}: 删除、不确定及非角色标签不能进入角色提示词。")


def _prompt_slot(item: TagDecision) -> tuple[int, int, str]:
    words = set(normalize_tag_key(item.replacement or item.tag).split("_"))
    if item.category == "identity":
        slot = 0
    elif item.category == "eyes":
        slot = 2
    elif item.category == "hair":
        slot = 3 if words & COLORS else 4 if words & {"long", "short", "medium"} else 5
    elif words & {"hairband", "hairclip", "hairpin"} or "hair" in words:
        slot = 6
    elif words & {"hat", "beret", "headwear", "hood"}:
        slot = 7
    elif words & {"gloves", "bracelet", "armwear", "wristband"}:
        slot = 12
    elif item.category in {"face", "body", "accessory"}:
        slot = 8
    elif item.category == "legwear":
        slot = 13
    elif item.category == "footwear":
        slot = 14
    elif words & {"bikini", "swimsuit", "leotard", "dress"}:
        slot = 10
    elif words & {"skirt", "pants", "shorts"}:
        slot = 11
    else:
        slot = 9
    return slot, item.prompt_order, item.tag


def character_prompt(profile: CharacterProfile, decisions: Sequence[TagDecision]) -> str:
    ordered = sorted((item for item in decisions if item.include_in_prompt), key=_prompt_slot)
    subject = {"girl": "1girl", "boy": "1boy", "unknown": None}[profile.subject]
    tags = [profile.trigger, *([subject] if subject else [])]
    seen = {normalize_tag_key(tag) for tag in tags}
    for item in ordered:
        tag = item.replacement if item.decision == "replace" else item.tag
        if tag and normalize_tag_key(tag) not in seen:
            tags.append(tag)
            seen.add(normalize_tag_key(tag))
    return ", ".join(tags)


def _outcome(item: TagDecision) -> tuple[str, str | None]:
    if item.decision in {"keep", "uncertain"}:
        return "keep", None
    return item.decision, normalize_tag_key(item.replacement) if item.replacement else None


def _subject_tags(
    tags: list[AnnotationTag], profiles: Sequence[CharacterProfile]
) -> list[AnnotationTag]:
    result = (
        [tag for tag in tags if normalize_tag_key(tag.name) != "solo"]
        if len(profiles) >= 2
        else list(tags)
    )
    if any(profile.subject == "unknown" for profile in profiles):
        return result
    for subject in ("girl", "boy"):
        count = sum(profile.subject == subject for profile in profiles)
        if not count:
            continue
        existing = [
            int(match.group(1))
            for tag in result
            if (match := re.fullmatch(rf"(\d+){subject}s?", normalize_tag_key(tag.name)))
        ]
        if existing and max(existing) >= count:
            continue
        result = [
            tag
            for tag in result
            if not re.fullmatch(rf"\d+{subject}s?", normalize_tag_key(tag.name))
        ]
        result.append(
            AnnotationTag(
                name=f"{count}{subject}{'s' if count > 1 else ''}",
                category="general",
                confidence=None,
                origin="character_audit",
            )
        )
    return result


def build_preview(operation: AuditOperation) -> ApplyPreview:
    decisions = [
        {normalize_tag_key(item.tag): item for item in review.decisions}
        for review in operation.reviews
    ]
    resolutions = {(item.asset_id, item.tag): item for item in operation.resolutions}
    changes: list[AssetChange] = []
    conflicts: list[TagConflict] = []
    for asset in operation.source_assets:
        present = membership(asset, operation.request.profiles)
        if not present:
            continue
        after: list[AnnotationTag] = []
        for tag in asset.tags:
            key = normalize_tag_key(tag.name)
            proposals = []
            for index in present:
                item = decisions[index].get(key)
                if item is None:
                    item = TagDecision(
                        tag=tag.name,
                        decision="keep",
                        category="other",
                        reason="此角色未审查该标签，不能代表此角色删除。",
                        replacement=None,
                        include_in_prompt=False,
                        prompt_order=0,
                    )
                proposals.append(item)
            outcome = _outcome(proposals[0])
            replacement = proposals[0].replacement
            if any(_outcome(item) != outcome for item in proposals[1:]):
                resolution = resolutions.get((asset.asset_id, tag.name))
                conflicts.append(
                    TagConflict(
                        asset_id=asset.asset_id,
                        tag=tag.name,
                        proposals=proposals,
                        resolution=resolution,
                    )
                )
                outcome = (
                    (resolution.decision, resolution.replacement) if resolution else ("keep", None)
                )
                replacement = resolution.replacement if resolution else None
            if outcome[0] == "delete":
                continue
            if outcome[0] == "replace" and replacement:
                after.append(
                    AnnotationTag(
                        name=replacement,
                        category=tag.category,
                        confidence=None,
                        origin="character_audit",
                    )
                )
            else:
                after.append(tag)
        profiles = [operation.request.profiles[index] for index in present]
        after = _subject_tags(after, profiles)
        keys = {normalize_tag_key(tag.name) for tag in after}
        after = [
            *after,
            *(
                AnnotationTag(
                    name=profile.trigger,
                    category="character",
                    confidence=None,
                    origin="character_audit",
                )
                for profile in profiles
                if normalize_tag_key(profile.trigger) not in keys
            ),
        ]
        originals = {normalize_tag_key(tag.name): tag for tag in asset.tags}
        unique: dict[str, AnnotationTag] = {}
        for tag in after:
            key = normalize_tag_key(tag.name)
            unique.setdefault(key, tag)
            if tag == originals.get(key):
                unique[key] = tag
        final = list(unique.values())
        if final != asset.tags:
            changes.append(
                AssetChange(
                    asset_id=asset.asset_id,
                    relative_path=asset.relative_path,
                    before=asset.tags,
                    after=final,
                )
            )
    token = hashlib.sha256(
        json.dumps(
            {
                "id": operation.id,
                "version": operation.version,
                "sources": [item.model_dump() for item in operation.source_assets],
                "references": [item.model_dump() for item in operation.references],
                "changes": [item.model_dump() for item in changes],
                "resolutions": [item.model_dump() for item in operation.resolutions],
            },
            sort_keys=True,
            ensure_ascii=False,
        ).encode()
    ).hexdigest()
    return ApplyPreview(
        preview_token=token,
        changed_count=len(changes),
        changes=changes,
        conflicts=conflicts,
        membership=membership_preview(operation.source_assets, operation.request.profiles),
    )


def validate_resolutions(
    operation: AuditOperation, resolutions: Sequence[ConflictResolution]
) -> None:
    conflicts = {(item.asset_id, item.tag): item for item in build_preview(operation).conflicts}
    seen = set()
    for resolution in resolutions:
        key = resolution.asset_id, resolution.tag
        if key in seen or key not in conflicts:
            raise AuditPolicyError("冲突裁决包含重复或不存在的冲突项，请重新预览。")
        seen.add(key)
        if resolution.decision == "keep":
            if resolution.replacement is not None:
                raise AuditPolicyError("保留决定不能填写替换词。")
        elif not any(
            item.decision == "replace" and item.replacement == resolution.replacement
            for item in conflicts[key].proposals
        ):
            raise AuditPolicyError("冲突替换必须选择已通过保护规则校验的角色替换建议。")
