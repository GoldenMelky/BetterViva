"""Normalizzazione e statistiche dei voti ClasseViva."""
from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP


DEFAULT_AVERAGE_MODE = "all_grades"
AVERAGE_MODES = (DEFAULT_AVERAGE_MODE, "average_of_averages")


def _decimal(value: object) -> Decimal | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return number if number.is_finite() else None


def _weighted_average(weighted_grades: list[tuple[Decimal, Decimal]]) -> Decimal | None:
    total_weight = sum((weight for _, weight in weighted_grades), Decimal(0))
    if not total_weight:
        return None
    return sum((grade * weight for grade, weight in weighted_grades), Decimal(0)) / total_weight


def _rounded(value: Decimal | None) -> float | None:
    if value is None:
        return None
    return float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _contribution(grade: dict) -> tuple[Decimal, Decimal] | None:
    if grade.get("canceled") is True or grade.get("noAverage") is True:
        return None
    value = _decimal(grade.get("decimalValue"))
    weight = _decimal(grade.get("weightFactor", 1))
    if value is None or weight is None or weight <= 0:
        return None
    return value, weight


def _subject_key(grade: dict) -> tuple[object, str]:
    return grade.get("subjectId"), str(grade.get("subjectDesc") or "")


def _stats(grades: list[dict], average_mode: str) -> dict:
    by_subject: dict[tuple[object, str], list[dict]] = {}
    contributors: list[tuple[Decimal, Decimal]] = []
    for grade in grades:
        by_subject.setdefault(_subject_key(grade), []).append(grade)
        contribution = _contribution(grade)
        if contribution is not None:
            contributors.append(contribution)

    subjects = []
    subject_averages = []
    for (subject_id, description), subject_grades in by_subject.items():
        subject_contributors = [
            contribution for grade in subject_grades
            if (contribution := _contribution(grade)) is not None
        ]
        subject_average = _weighted_average(subject_contributors)
        if subject_average is not None:
            subject_averages.append(subject_average)
        subjects.append({
            "subjectId": subject_id,
            "subjectDesc": description,
            "subjectName": subject_grades[0].get("subjectName", description),
            "average": _rounded(subject_average),
            "gradeCount": len(subject_contributors),
            "grades": subject_grades,
        })

    average_all_grades = _weighted_average(contributors)
    average_of_averages = None
    if subject_averages:
        average_of_averages = sum(subject_averages, Decimal(0)) / len(subject_averages)

    return {
        "average": _rounded(average_of_averages if average_mode == "average_of_averages" else average_all_grades),
        "averageAllGrades": _rounded(average_all_grades),
        "averageOfAverages": _rounded(average_of_averages),
        "gradeCount": len(contributors),
        "subjectCount": len(subject_averages),
        "subjects": subjects,
    }


def build_grade_data(grades: list[dict], average_mode: str, subject_config: dict,
                     short_names: dict[str, str]) -> dict:
    """Arricchisce i voti e calcola medie annuali e per periodo."""
    if average_mode not in AVERAGE_MODES:
        average_mode = DEFAULT_AVERAGE_MODE

    enriched = []
    for grade in grades:
        if not isinstance(grade, dict):
            raise ValueError("Il servizio voti ha restituito un elemento non valido.")
        subject_id, description = _subject_key(grade)
        config = subject_config.get(str(subject_id), {})
        custom_name = config.get("name") if isinstance(config, dict) else None
        display_name = custom_name or short_names.get(description.strip().upper())
        if not display_name:
            display_name = description.strip().capitalize()
        enriched.append({**grade, "subjectName": display_name})

    grouped_periods: dict[object, list[dict]] = {}
    period_info: dict[object, dict] = {}
    for grade in enriched:
        position = grade.get("periodPos")
        grouped_periods.setdefault(position, []).append(grade)
        period_info.setdefault(position, {
            "periodPos": position,
            "periodDesc": grade.get("periodDesc"),
            "periodLabel": grade.get("periodLabel"),
        })

    def period_sort_key(position: object) -> tuple[int, str]:
        if isinstance(position, int) and not isinstance(position, bool):
            return 0, f"{position:010d}"
        if isinstance(position, str):
            try:
                return 0, f"{int(position):010d}"
            except ValueError:
                pass
        return 1, str(position)

    periods = [
        {**period_info[position], **_stats(grouped_periods[position], average_mode)}
        for position in sorted(grouped_periods, key=period_sort_key)
    ]
    return {
        "averageMode": average_mode,
        "overall": _stats(enriched, average_mode),
        "periods": periods,
        "grades": enriched,
    }
