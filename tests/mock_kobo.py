#!/usr/bin/env python3
"""Fake KoboToolbox v2 API for testing offline. Mirrors the real SENSE form structures:
Annex F (screening + school_code), G, H (school_code) and the School Assessment form
(school_name only, no code), with the data quirks seen in the field (blank districts,
a region typed as a district, name spelling variants).

    python tests/mock_kobo.py 8765 &
    KOBO_TOKEN=test KOBO_BASE_URL=http://127.0.0.1:8765 python scripts/kobo_pull.py
    python scripts/summarize.py && python scripts/roster.py
"""
import json
import random
import sys
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

random.seed(11)
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
UIDS = {"F": "ak95trCoSBkM3aKqZysbdB", "G": "axDMBKEfMJYtZ5LiHqCMbb", "H": "aokEegtT2X8oyCDfQCWeZR", "A": "ajj7kZq2be5XDFSio3zJHu",
        "DM": "aGUvS64iEXZ6iANRKySPRT", "DE": "a7MfPjqYzU6MVRefeukEpF", "DP": "aUngKSUyshfP9f2ncmgpzF",
        "NL": "anWs3BHcedteBeE4KVm2aY", "BL": "aKHoLcChEGxRqCksRpadQN"}
DISTRICTS = {"LUWERO": "BUGANDA", "NAKASEKE": "BUGANDA", "HOIMA": "BUNYORO", "KAGADI": "BUNYORO", "KIBAALE": "BUNYORO",
             "KAKUMIRO": "BUNYORO", "KIKUUBE": "BUNYORO", "MASINDI": "BUNYORO", "KIRYANDONGO": "BUNYORO",
             "BULIISA": "BUNYORO", "BUKEDEA": "TESO", "GULU CITY": "ACHOLI", "KARENGA": "KARAMOJA"}
OFFICERS = ["TE", "BA", "JK", "RN", "PO"]
EAT = timezone(timedelta(hours=3))

# 90 schools with codes; names with realistic variants
SCHOOLS = []
for i in range(1, 91):
    d = random.choice(list(DISTRICTS))
    base = random.choice(["ST. MARY'S", "ST. JOSEPH'S", "KINGS", "BISHOP", "TRINITY", "HOLY CROSS", "VICTORIA", "SACRED HEART", "ST. PETER'S"]) + f" {random.choice(['SS', 'S.S.', 'SECONDARY SCHOOL', 'COLLEGE', 'HIGH SCHOOL'])} {d.title()}{'' if i % 7 else ' Annex'} {i}"
    SCHOOLS.append({"code": f"SCH{i:03d}", "name": base, "district": d, "region": DISTRICTS[d]})


def variant(name: str) -> str:
    """How the same school gets typed into the assessment form."""
    v = name
    r = random.random()
    if r < 0.4:
        v = v.replace("SECONDARY SCHOOL", "S.S").replace("S.S.", "SS").replace("HIGH SCHOOL", "H/S")
    elif r < 0.6:
        v = v.lower().replace("st. ", "st ").title()
    elif r < 0.7:
        v = v.replace("'", "")
    return v


def ts(d: datetime) -> str:
    return d.strftime("%Y-%m-%dT%H:%M:%S")


def when(i: int) -> datetime:
    return datetime(2026, 9, 23, tzinfo=timezone.utc) + timedelta(days=min(21, i // 4), hours=random.randint(6, 15))


def choices_schools():
    return [{"list_name": "schools", "name": s["code"], "label": [f"{s['code']}"]} for s in SCHOOLS]


SURVEYS = {
    "F": [
        {"type": "start", "name": "start", "$xpath": "start"}, {"type": "end", "name": "end", "$xpath": "end"},
        {"type": "select_one", "name": "atleast_300_boarders", "$xpath": "School_screening_grp/atleast_300_boarders", "label": ["≥300 boarders"], "select_from_list_name": "yn"},
        {"type": "calculate", "name": "overall_status", "$xpath": "School_screening_grp/overall_status"},
        {"type": "select_one", "name": "school_code", "$xpath": "School_Identification_grp/school_code", "label": ["School code"], "select_from_list_name": "schools"},
        {"type": "text", "name": "school_name", "$xpath": "School_Identification_grp/school_name", "label": ["Name of the school"]},
        {"type": "text", "name": "district", "$xpath": "School_Identification_grp/district", "label": ["District"]},
        {"type": "text", "name": "region", "$xpath": "School_Identification_grp/region", "label": ["Region"]},
        {"type": "date", "name": "enrollment_date", "$xpath": "School_Identification_grp/enrollment_date", "label": ["Date of enrolment visit"]},
        {"type": "geopoint", "name": "geo_location", "$xpath": "School_Identification_grp/geo_location", "label": ["GPS"]},
        {"type": "text", "name": "nurse_name", "$xpath": "school_health_personnel_grp/nurse_name", "label": ["Nurse"]},
        {"type": "text", "name": "nurse_contact", "$xpath": "school_health_personnel_grp/nurse_contact", "label": ["Nurse phone"]},
        {"type": "select_one", "name": "nurse_qualification", "$xpath": "school_health_personnel_grp/nurse_qualification", "label": ["Nurse qualification"], "select_from_list_name": "quals"},
        {"type": "select_one", "name": "dedicated_sickbay", "$xpath": "school_health_personnel_grp/dedicated_sickbay", "label": ["Dedicated sick bay"], "select_from_list_name": "yn"},
        {"type": "select_multiple", "name": "test_supplies", "$xpath": "malaria_diagnostic_procedure_grp/test_supplies", "label": ["Testing supplies"], "select_from_list_name": "supplies"},
        {"type": "select_one", "name": "school_type", "$xpath": "School_Identification_grp/school_type", "label": ["School type"], "select_from_list_name": "stypes"},
        {"type": "select_multiple", "name": "nurse_working_days", "$xpath": "school_health_personnel_grp/nurse_working_days", "label": ["Working days"], "select_from_list_name": "days"},
        {"type": "time", "name": "nurse_start_time", "$xpath": "school_health_personnel_grp/nurse_start_time", "label": ["Start"]},
        {"type": "time", "name": "nurse_endtime_time", "$xpath": "school_health_personnel_grp/nurse_endtime_time", "label": ["End"]},
        {"type": "text", "name": "cover_arrangement", "$xpath": "school_health_personnel_grp/cover_arrangement", "label": ["Cover"]},
        {"type": "select_multiple", "name": "type_rdt_used", "$xpath": "malaria_diagnostic_procedure_grp/type_rdt_used", "label": ["RDT type"], "select_from_list_name": "rdts"},
        {"type": "select_multiple", "name": "type_act_used", "$xpath": "malaria_diagnostic_procedure_grp/type_act_used", "label": ["ACT type"], "select_from_list_name": "acts"},
        {"type": "select_one", "name": "where_supplies_stored", "$xpath": "malaria_diagnostic_procedure_grp/where_supplies_stored", "label": ["Stored"], "select_from_list_name": "stores"},
        {"type": "text", "name": "notes_diagnostic_procedure", "$xpath": "malaria_diagnostic_procedure_grp/notes_diagnostic_procedure", "label": ["Notes"]},
        {"type": "select_one", "name": "data_officer", "$xpath": "Respondent_signature_grp/data_officer", "label": ["Data officer"], "select_from_list_name": "officers"},
    ],
    "G": [
        {"type": "start", "name": "start", "$xpath": "start"}, {"type": "end", "name": "end", "$xpath": "end"},
        {"type": "select_one", "name": "school_code", "$xpath": "School_Identification_grp/school_code", "label": ["School code"], "select_from_list_name": "schools"},
        {"type": "text", "name": "school_name", "$xpath": "School_Identification_grp/school_name", "label": ["Name"]},
        {"type": "text", "name": "district", "$xpath": "School_Identification_grp/district", "label": ["District"]},
        {"type": "text", "name": "region", "$xpath": "School_Identification_grp/region", "label": ["Region"]},
        {"type": "select_one", "name": "within_breeding_site", "$xpath": "school_physical_infrastructure_grp/within_breeding_site", "label": ["Breeding sites within"], "select_from_list_name": "yn"},
        {"type": "select_one", "name": "outside_breeding_site", "$xpath": "school_physical_infrastructure_grp/outside_breeding_site", "label": ["Breeding sites outside"], "select_from_list_name": "yn"},
        {"type": "select_one", "name": "open_containers", "$xpath": "school_physical_infrastructure_grp/open_containers", "label": ["Open containers"], "select_from_list_name": "yn"},
        {"type": "select_one", "name": "functional_drainage_sys", "$xpath": "school_physical_infrastructure_grp/functional_drainage_sys", "label": ["Drainage"], "select_from_list_name": "yn"},
        {"type": "integer", "name": "total_dormitories", "$xpath": "physical_infrastructure_grp/total_dormitories", "label": ["Number of dormitories"]},
        {"type": "integer", "name": "total_classrooms", "$xpath": "physical_infrastructure_grp/total_classrooms", "label": ["Number of classrooms"]},
        {"type": "integer", "name": "total_quarters", "$xpath": "physical_infrastructure_grp/total_quarters", "label": ["Teachers quarters"]},
        {"type": "integer", "name": "total_bathrooms", "$xpath": "physical_infrastructure_grp/total_bathrooms", "label": ["Bathrooms (stances)"]},
        {"type": "calculate", "name": "total_structures", "$xpath": "total_structures"},
        {"type": "begin_repeat", "name": "Classrooms_dormitories_grp", "$xpath": "Classrooms_dormitories_grp", "label": ["Structures"]},
        {"type": "select_one", "name": "structure_category", "$xpath": "Classrooms_dormitories_grp/structure_category", "label": ["Category"], "select_from_list_name": "cats"},
        {"type": "select_one", "name": "wall_material", "$xpath": "Classrooms_dormitories_grp/wall_material", "label": ["Wall material"], "select_from_list_name": "walls"},
        {"type": "select_one", "name": "roof_material", "$xpath": "Classrooms_dormitories_grp/roof_material", "label": ["Roof material"], "select_from_list_name": "roofs"},
        {"type": "integer", "name": "dormitory_capacity", "$xpath": "Classrooms_dormitories_grp/dormitory_capacity", "label": ["Dormitory capacity (beds)"]},
        {"type": "select_one", "name": "presence_open_eaves", "$xpath": "Classrooms_dormitories_grp/presence_open_eaves", "label": ["Open eaves"], "select_from_list_name": "yn"},
        {"type": "select_one", "name": "screened_windows", "$xpath": "Classrooms_dormitories_grp/screened_windows", "label": ["Screened windows"], "select_from_list_name": "yn"},
        {"type": "select_one", "name": "bednets_hung", "$xpath": "Classrooms_dormitories_grp/bednets_hung", "label": ["Bed nets hung"], "select_from_list_name": "yn"},
        {"type": "end_repeat", "name": "Classrooms_dormitories_grp"},
        {"type": "select_one", "name": "drainage_channel_end", "$xpath": "school_physical_infrastructure_grp/drainage_channel_end", "label": ["Drain ends"], "select_from_list_name": "drains"},
        {"type": "select_one", "name": "history_pesticide_use", "$xpath": "malaria_prevention_features_grp/history_pesticide_use", "label": ["Pesticide history"], "select_from_list_name": "hist"},
        {"type": "select_one", "name": "irs_history", "$xpath": "malaria_prevention_features_grp/irs_history", "label": ["IRS history"], "select_from_list_name": "hist"},
        {"type": "text", "name": "notes_general_observations", "$xpath": "Respondent_signature_grp/notes_general_observations", "label": ["Notes"]},
        {"type": "select_one", "name": "data_officer", "$xpath": "Respondent_signature_grp/data_officer", "label": ["Data officer"], "select_from_list_name": "officers"},
    ],
    "H": [
        {"type": "start", "name": "start", "$xpath": "start"}, {"type": "end", "name": "end", "$xpath": "end"},
        {"type": "select_one", "name": "school_code", "$xpath": "School_location_info_grp/school_code", "label": ["School code"], "select_from_list_name": "schools"},
        {"type": "text", "name": "school_name", "$xpath": "School_location_info_grp/school_name", "label": ["Name"]},
        {"type": "text", "name": "district", "$xpath": "School_location_info_grp/district", "label": ["District"]},
        {"type": "text", "name": "region", "$xpath": "School_location_info_grp/region", "label": ["Region"]},
        {"type": "text", "name": "head_master", "$xpath": "School_location_info_grp/head_master", "label": ["Head teacher"]},
        {"type": "text", "name": "hm_contact", "$xpath": "School_location_info_grp/hm_contact", "label": ["HT contact"]},
        {"type": "date", "name": "completion_date", "$xpath": "School_location_info_grp/completion_date", "label": ["Completion date"]},
        {"type": "begin_repeat", "name": "Enrollment_data_grp", "$xpath": "Enrollment_data_grp", "label": ["Enrolment data"]},
        {"type": "select_one", "name": "year", "$xpath": "Enrollment_data_grp/year", "label": ["Year"], "select_from_list_name": "years"},
        {"type": "select_one", "name": "term", "$xpath": "Enrollment_data_grp/term", "label": ["Term"], "select_from_list_name": "terms"},
        {"type": "integer", "name": "total_school_enroll", "$xpath": "Enrollment_data_grp/total_school_enroll", "label": ["Total school enrollment"]},
        {"type": "integer", "name": "total_boarders", "$xpath": "Enrollment_data_grp/total_boarders", "label": ["Total boarders"]},
        {"type": "integer", "name": "total_malaria_cases", "$xpath": "Enrollment_data_grp/total_malaria_cases", "label": ["Total malaria cases"]},
        {"type": "integer", "name": "confirmed_malaria", "$xpath": "Enrollment_data_grp/confirmed_malaria", "label": ["Confirmed malaria cases"]},
        {"type": "integer", "name": "total_severe_cases", "$xpath": "Enrollment_data_grp/total_severe_cases", "label": ["Severe cases"]},
        {"type": "integer", "name": "total_rdt_used", "$xpath": "Enrollment_data_grp/total_rdt_used", "label": ["RDT used"]},
        {"type": "integer", "name": "total_act_used", "$xpath": "Enrollment_data_grp/total_act_used", "label": ["ACT used"]},
        {"type": "end_repeat", "name": "Enrollment_data_grp"},
        {"type": "select_one", "name": "data_officer", "$xpath": "data_officer", "label": ["Data officer"], "select_from_list_name": "officers"},
    ],
    "A": [
        {"type": "start", "name": "start", "$xpath": "start"}, {"type": "end", "name": "end", "$xpath": "end"},
        {"type": "select_one", "name": "region", "$xpath": "School_assessment_grp/region", "label": ["Region"], "select_from_list_name": "regions"},
        {"type": "select_one", "name": "district", "$xpath": "School_assessment_grp/district", "label": ["District"], "select_from_list_name": "districts"},
        {"type": "text", "name": "school_name", "$xpath": "School_assessment_grp/school_name", "label": ["School Name"]},
        {"type": "date", "name": "visit_date", "$xpath": "School_assessment_grp/visit_date", "label": ["Visit date"]},
        {"type": "select_one", "name": "springfiles_received", "$xpath": "School_assessment_grp/springfiles_received", "label": ["Spring file"], "select_from_list_name": "yn"},
        {"type": "select_one", "name": "consent_signed", "$xpath": "School_assessment_grp/consent_signed", "label": ["Consent"], "select_from_list_name": "yn"},
        {"type": "select_one", "name": "training_conducted", "$xpath": "School_assessment_grp/training_conducted", "label": ["Training"], "select_from_list_name": "yn"},
        {"type": "select_one", "name": "retros_data_collected", "$xpath": "School_assessment_grp/retros_data_collected", "label": ["Retro data"], "select_from_list_name": "yn"},
        {"type": "select_one", "name": "data_officer", "$xpath": "School_assessment_grp/data_officer", "label": ["Data officer"], "select_from_list_name": "officers"},
    ],
}
SURVEYS["DM"] = [
    {"type": "start", "name": "start", "$xpath": "start"}, {"type": "end", "name": "end", "$xpath": "end"},
    {"type": "select_one", "name": "district", "$xpath": "School_location_info_grp/district", "label": ["District"], "select_from_list_name": "districts"},
    {"type": "text", "name": "district_code", "$xpath": "School_location_info_grp/district_code", "label": ["District Code"]},
    {"type": "date", "name": "meeting_entry_date", "$xpath": "School_location_info_grp/meeting_entry_date", "label": ["Entry meeting date"]},
    {"type": "select_one", "name": "mous_signed", "$xpath": "School_location_info_grp/mous_signed", "label": ["MOU signed"], "select_from_list_name": "yn"},
    {"type": "integer", "name": "num_schools_attended", "$xpath": "School_location_info_grp/num_schools_attended", "label": ["Schools attended"]},
    {"type": "select_one", "name": "Entrant_Initials", "$xpath": "School_location_info_grp/Entrant_Initials", "label": ["Initials"], "select_from_list_name": "officers"},
]
SURVEYS["DE"] = [
    {"type": "start", "name": "start", "$xpath": "start"}, {"type": "end", "name": "end", "$xpath": "end"},
    {"type": "select_one", "name": "district", "$xpath": "meeting_info_grp/district", "label": ["District"], "select_from_list_name": "districts"},
    {"type": "text", "name": "district_code", "$xpath": "meeting_info_grp/district_code", "label": ["District Code"]},
    {"type": "integer", "name": "num_schools_mobilized", "$xpath": "meeting_info_grp/num_schools_mobilized", "label": ["Target schools mobilized"]},
    {"type": "integer", "name": "num_conf_attendance", "$xpath": "meeting_info_grp/num_conf_attendance", "label": ["Confirmed"]},
    {"type": "date", "name": "resched_meeting_date", "$xpath": "meeting_info_grp/resched_meeting_date", "label": ["New date"]},
]
SURVEYS["DP"] = [
    {"type": "start", "name": "start", "$xpath": "start"}, {"type": "end", "name": "end", "$xpath": "end"},
    {"type": "select_one", "name": "district", "$xpath": "meeting_info_grp/district", "label": ["District"], "select_from_list_name": "districts"},
    {"type": "text", "name": "district_code", "$xpath": "meeting_info_grp/district_code", "label": ["District Code"]},
    {"type": "select_one", "name": "list_schools_obtained", "$xpath": "meeting_info_grp/list_schools_obtained", "label": ["List obtained"], "select_from_list_name": "yn"},
    {"type": "date", "name": "entry_meeting_date", "$xpath": "meeting_info_grp/entry_meeting_date", "label": ["Entry meeting date"]},
    {"type": "text", "name": "deo_name", "$xpath": "meeting_info_grp/deo_name", "label": ["DEO name"]},
    {"type": "text", "name": "deo_contact", "$xpath": "meeting_info_grp/deo_contact", "label": ["DEO phone"]},
]
# Prospective logs, mirroring the real forms (state/forms_schema.json): the nurse log is a weekly
# school summary, the bursar log a termly procurement/cost summary. Both carry staff names and
# phone numbers that must never be published.
_yn = {"select_from_list_name": "yn"}
SURVEYS["NL"] = [
    {"type": "start", "name": "start", "$xpath": "start"}, {"type": "end", "name": "end", "$xpath": "end"},
    {"type": "select_one", "name": "school_code", "$xpath": "school_info_grp/school_code", "label": ["School code (de-identified study code)"], "select_from_list_name": "schools"},
    {"type": "text", "name": "school_name", "$xpath": "school_info_grp/school_name", "label": ["Name of the school (Official name)"]},
    {"type": "text", "name": "district", "$xpath": "school_info_grp/district", "label": ["District"]},
    {"type": "text", "name": "nurse_name", "$xpath": "school_info_grp/nurse_name", "label": ["Name of nurse"]},
    {"type": "text", "name": "nurse_contact", "$xpath": "school_info_grp/nurse_contact", "label": ["Contact of nurse"]},
    {"type": "select_one", "name": "year", "$xpath": "period_grp/year", "label": ["Select year"], "select_from_list_name": "years"},
    {"type": "select_one", "name": "term", "$xpath": "period_grp/term", "label": ["Select term"], "select_from_list_name": "terms"},
    {"type": "date", "name": "week_start_date", "$xpath": "period_grp/week_start_date", "label": ["Reporting period - Week start date"]},
    {"type": "date", "name": "week_end_date", "$xpath": "period_grp/week_end_date", "label": ["Reporting period - Week end date"]},
    {"type": "integer", "name": "total_cases_boarders", "$xpath": "cases_grp/total_cases_boarders", "label": ["Total cases - boarders"]},
    {"type": "integer", "name": "confirmed_boarders", "$xpath": "cases_grp/confirmed_boarders", "label": ["Confirmed - boarders"]},
    {"type": "integer", "name": "total_cases_day", "$xpath": "cases_grp/total_cases_day", "label": ["Total cases - day students"]},
    {"type": "integer", "name": "confirmed_day", "$xpath": "cases_grp/confirmed_day", "label": ["Confirmed - day students"]},
    {"type": "calculate", "name": "val_confirmed_cases_boarders", "$xpath": "cases_grp/val_confirmed_cases_boarders"},
    {"type": "integer", "name": "total_severe_cases", "$xpath": "cases_grp/total_severe_cases", "label": ["Total severe cases"]},
    {"type": "integer", "name": "severe_cases_boarders", "$xpath": "cases_grp/severe_cases_boarders", "label": ["Severe cases - boarders"]},
    {"type": "select_one", "name": "chk_mal_tests_treat", "$xpath": "supplies_grp/chk_mal_tests_treat", "label": ["Does the school test and treat malaria cases within school's infirmry?"], **_yn},
    {"type": "integer", "name": "rdt_used", "$xpath": "supplies_grp/rdt_used", "label": ["Total RDTs used"]},
    {"type": "integer", "name": "acts_used", "$xpath": "supplies_grp/acts_used", "label": ["Total ACTs used"]},
    {"type": "integer", "name": "artesunate_used", "$xpath": "supplies_grp/artesunate_used", "label": ["Total IV Artesunate vials used"]},
    {"type": "select_one", "name": "rdt_stock", "$xpath": "supplies_grp/rdt_stock", "label": ["Any RDT stockout?"], **_yn},
    {"type": "select_one", "name": "act_stock", "$xpath": "supplies_grp/act_stock", "label": ["Any ACT stockout?"], **_yn},
    {"type": "select_one", "name": "notified_stockout", "$xpath": "supplies_grp/notified_stockout", "label": ["Study team notified of stockout?"], **_yn},
    {"type": "select_one", "name": "chk_calibration_cohort_school", "$xpath": "absent_grp/chk_calibration_cohort_school", "label": ["Is this school one of the absenteeism calibration cohort?"], **_yn},
    {"type": "integer", "name": "ord_casedayslost_boarders", "$xpath": "absent_grp/ord_casedayslost_boarders", "label": ["Uncomplicated-case days lost — boarders"]},
    {"type": "integer", "name": "ord_casedayslost_day", "$xpath": "absent_grp/ord_casedayslost_day", "label": ["Uncomplicated-case days lost — day students"]},
    {"type": "integer", "name": "sev_casedayslost_boarders", "$xpath": "absent_grp/sev_casedayslost_boarders", "label": ["Severe-case days lost — boarders"]},
    {"type": "integer", "name": "sev_casedayslost_day", "$xpath": "absent_grp/sev_casedayslost_day", "label": ["Severe-case days lost — day students"]},
    {"type": "select_one", "name": "respond_attestation", "$xpath": "sign_grp/respond_attestation", "label": ["Nurse attestation"], **_yn},
    {"type": "date", "name": "attestation_date", "$xpath": "sign_grp/attestation_date", "label": ["Nurse attestation date"]},
    {"type": "select_one", "name": "data_officer", "$xpath": "sign_grp/data_officer", "label": ["Select your data officer"], "select_from_list_name": "officers"},
]
SURVEYS["BL"] = [
    {"type": "start", "name": "start", "$xpath": "start"}, {"type": "end", "name": "end", "$xpath": "end"},
    {"type": "select_one", "name": "school_code", "$xpath": "school_info_grp/school_code", "label": ["School code (de-identified study code)"], "select_from_list_name": "schools"},
    {"type": "text", "name": "school_name", "$xpath": "school_info_grp/school_name", "label": ["Name of the school (Official name)"]},
    {"type": "text", "name": "bursar_name", "$xpath": "school_info_grp/bursar_name", "label": ["Name of bursar"]},
    {"type": "text", "name": "bursar_contact", "$xpath": "school_info_grp/bursar_contact", "label": ["Contact of bursar"]},
    {"type": "select_one", "name": "year", "$xpath": "period_grp/year", "label": ["Select year"], "select_from_list_name": "years"},
    {"type": "select_one", "name": "term", "$xpath": "period_grp/term", "label": ["Select term"], "select_from_list_name": "terms"},
    {"type": "date", "name": "completion_date", "$xpath": "period_grp/completion_date", "label": ["Completion date"]},
    {"type": "integer", "name": "total_school_enroll", "$xpath": "enrol_grp/total_school_enroll", "label": ["Total school enrollment"]},
    {"type": "integer", "name": "total_boarders", "$xpath": "enrol_grp/total_boarders", "label": ["Total boarders"]},
    {"type": "calculate", "name": "calc_total_day", "$xpath": "enrol_grp/calc_total_day"},
    {"type": "date", "name": "first_insession_date", "$xpath": "enrol_grp/first_insession_date", "label": ["First in-session date"]},
    {"type": "date", "name": "last_insession_date", "$xpath": "enrol_grp/last_insession_date", "label": ["Last in-session date"]},
    {"type": "calculate", "name": "calc_insession_days", "$xpath": "enrol_grp/calc_insession_days"},
    {"type": "select_one", "name": "chk_rdt_tests", "$xpath": "rdt_grp/chk_rdt_tests", "label": ["Does the school test for malaria using RDT?"], **_yn},
    {"type": "integer", "name": "rdt_qty", "$xpath": "rdt_grp/rdt_qty", "label": ["RDTs procured by the school (units)"]},
    {"type": "select_multiple", "name": "rdt_type", "$xpath": "rdt_grp/rdt_type", "label": ["RDT brand / type"], "select_from_list_name": "rdts"},
    {"type": "select_one", "name": "rdt_unit", "$xpath": "rdt_grp/rdt_unit", "label": ["RDT unit"], "select_from_list_name": "rdt_unit_list"},
    {"type": "integer", "name": "rdt_unitcost", "$xpath": "rdt_grp/rdt_unitcost", "label": ["RDT unit cost (UGX)"]},
    {"type": "select_one", "name": "prev_rdt_stock", "$xpath": "rdt_grp/prev_rdt_stock", "label": ["Any RDT from previous procurement carried forward?"], **_yn},
    {"type": "integer", "name": "prev_rdt_qty", "$xpath": "rdt_grp/prev_rdt_qty", "label": ["RDT (unit) balance carried forward"]},
    {"type": "select_one", "name": "chk_other_testing_costs", "$xpath": "rdt_grp/chk_other_testing_costs", "label": ["Any other cost related to testing for malaria?"], **_yn},
    {"type": "text", "name": "other_testing_items", "$xpath": "rdt_grp/other_testing_items", "label": ["List other testing items/consumables"]},
    {"type": "integer", "name": "other_testing_costs", "$xpath": "rdt_grp/other_testing_costs", "label": ["Other additional testing costs"]},
    {"type": "integer", "name": "act_qty", "$xpath": "act_grp/act_qty", "label": ["ACT procured by the school (units)"]},
    {"type": "select_multiple", "name": "act_brand_type", "$xpath": "act_grp/act_brand_type", "label": ["ACT brand / type"], "select_from_list_name": "acts"},
    {"type": "select_one", "name": "act_unit", "$xpath": "act_grp/act_unit", "label": ["ACT unit"], "select_from_list_name": "act_unit_list"},
    {"type": "integer", "name": "act_unitcost", "$xpath": "act_grp/act_unitcost", "label": ["ACT unit cost (UGX)"]},
    {"type": "select_one", "name": "prev_act_stock", "$xpath": "act_grp/prev_act_stock", "label": ["Any ACT from previous procurement carried forward?"], **_yn},
    {"type": "integer", "name": "prev_act_qty", "$xpath": "act_grp/prev_act_qty", "label": ["ACT (unit) balance carried forward"]},
    {"type": "select_one", "name": "chk_severe_mgt", "$xpath": "severe_grp/chk_severe_mgt", "label": ["Does the school manage severe / complicated malaria?"], **_yn},
    {"type": "integer", "name": "artesunate_qty", "$xpath": "severe_grp/artesunate_qty", "label": ["IV Artesunate (unit)"]},
    {"type": "integer", "name": "artesunate_unitcost", "$xpath": "severe_grp/artesunate_unitcost", "label": ["IV Artesunate unit cost (UGX)"]},
    {"type": "text", "name": "other_malaria_tx_items", "$xpath": "severe_grp/other_malaria_tx_items", "label": ["Other malaria treatment items"]},
    {"type": "integer", "name": "other_malaria_tx_costs", "$xpath": "severe_grp/other_malaria_tx_costs", "label": ["Other additional malaria treatment costs"]},
    {"type": "select_one", "name": "respond_attestation", "$xpath": "sign_grp/respond_attestation", "label": ["Respondent attestation"], **_yn},
    {"type": "date", "name": "attestation_date", "$xpath": "sign_grp/attestation_date", "label": ["Respondent attestation date"]},
    {"type": "select_one", "name": "data_officer", "$xpath": "sign_grp/data_officer", "label": ["Select your data officer"], "select_from_list_name": "officers"},
]
CHOICES = (choices_schools()
           + [{"list_name": "rdt_unit_list", "name": "kits", "label": ["KITS"]}, {"list_name": "act_unit_list", "name": "doses", "label": ["DOSES"]}, {"list_name": "terms", "name": "t3", "label": ["Term 3"]}]
           + [{"list_name": "yn", "name": "yes", "label": ["Yes"]}, {"list_name": "yn", "name": "no", "label": ["No"]}]
           + [{"list_name": "officers", "name": o.lower(), "label": [o]} for o in OFFICERS]
           + [{"list_name": "years", "name": "2026", "label": ["2026"]}, {"list_name": "terms", "name": "t1", "label": ["Term 1"]}, {"list_name": "terms", "name": "t2", "label": ["Term 2"]}]
           + [{"list_name": "districts", "name": d.lower().replace(" ", "_"), "label": [d]} for d in DISTRICTS]
           + [{"list_name": "cats", "name": c, "label": [c.title()]} for c in ("dormitory", "classroom", "quarters")]
           + [{"list_name": "walls", "name": w, "label": [w.title()]} for w in ("brick", "mud", "concrete")]
           + [{"list_name": "roofs", "name": r, "label": [r.title()]} for r in ("iron_sheets", "tiles", "thatch")]
           + [{"list_name": "quals", "name": q, "label": [q.title()]} for q in ("enrolled_nurse", "registered_nurse", "nursing_assistant")]
           + [{"list_name": "supplies", "name": s, "label": [s.upper()]} for s in ("rdt", "microscopy", "none")]
           + [{"list_name": "stypes", "name": s, "label": [s.title()]} for s in ("government", "private", "religious")]
           + [{"list_name": "days", "name": d[:3].lower(), "label": [d]} for d in ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")]
           + [{"list_name": "rdts", "name": r, "label": [r.replace("_", " ").title()]} for r in ("biocredit", "bioline", "standard_q", "other")]
           + [{"list_name": "acts", "name": a, "label": [a.title()]} for a in ("lonart", "coartem", "lumartem", "other")]
           + [{"list_name": "stores", "name": s, "label": [s.replace("_", " ").title()]} for s in ("nurse_office", "store_room", "head_office", "other")]
           + [{"list_name": "drains", "name": d, "label": [l]} for d, l in (("soak_pit", "On-site soak pit"), ("open_drain", "Open drain leaving the compound"), ("other", "Other"))]
           + [{"list_name": "hist", "name": h, "label": [l]} for h, l in (("last12", "Within the last 12 months"), ("over12", "More than 12 months ago"), ("never", "Never"))]
           + [{"list_name": "regions", "name": r.lower(), "label": [r]} for r in set(DISTRICTS.values())])


def build():
    data = {k: [] for k in UIDS}
    sid = 1000
    recruited = SCHOOLS[:74]
    # F: 74 recruited + 14 screened-out (no code)
    for i, s in enumerate(recruited + [None] * 14):
        t = when(i); sid += 1
        rec = {"_id": sid, "_uuid": f"f-{sid}", "_submission_time": ts(t + timedelta(hours=5)), "_submitted_by": "pa_sense",
               "start": (t).astimezone(EAT).isoformat(timespec="milliseconds"), "end": (t + timedelta(hours=random.choice([1, 5, 9]))).astimezone(EAT).isoformat(timespec="milliseconds"),
               "School_screening_grp/atleast_300_boarders": "yes" if s else "no",
               "School_screening_grp/overall_status": "ELIGIBLE" if s else "NOT ELIGIBLE",
               "Respondent_signature_grp/data_officer": random.choice(OFFICERS).lower(), "_attachments": [], "_geolocation": [1.7, 32.3] if s and random.random() > 0.2 else [None, None]}
        if s:
            rec.update({"School_Identification_grp/school_code": s["code"], "School_Identification_grp/school_name": "OKELLO JAMES" if i in (5, 9) else s["name"],
                        "School_Identification_grp/district": s["district"] if random.random() > 0.25 else "",   # blanks
                        "School_Identification_grp/region": s["region"], "School_Identification_grp/enrollment_date": t.date().isoformat(),
                        "school_health_personnel_grp/nurse_name": "Nurse X", "school_health_personnel_grp/nurse_contact": f"07{random.randint(10000000, 99999999)}",
                        "school_health_personnel_grp/nurse_qualification": random.choice(["enrolled_nurse", "registered_nurse", "nursing_assistant"]), "school_health_personnel_grp/dedicated_sickbay": random.choice(["yes", "no"]),
                        "malaria_diagnostic_procedure_grp/test_supplies": random.choice(["rdt", "rdt microscopy", "none"]), "School_Identification_grp/school_type": random.choice(["government", "private", "religious"]),
                        "school_health_personnel_grp/nurse_working_days": random.choice(["mon tue wed thu fri", "mon tue wed thu fri sat sun", "mon wed fri"]),
                        "school_health_personnel_grp/nurse_start_time": random.choice(["08:00:00.000+03:00", "07:00:00.000+03:00", "06:00:00.000+03:00"]), "school_health_personnel_grp/nurse_endtime_time": random.choice(["17:00:00.000+03:00", "22:00:00.000+03:00", "06:00:00.000+03:00"]),
                        "school_health_personnel_grp/cover_arrangement": random.choice(["Nurse stays on site, on duty 24 hours", "Refers to health centre after hours; matron on duty", "Part-time nurse comes Mon-Fri"]),
                        "malaria_diagnostic_procedure_grp/type_rdt_used": random.choice(["biocredit", "bioline standard_q", "other"]), "malaria_diagnostic_procedure_grp/type_act_used": random.choice(["lonart", "coartem lumartem", "other"]),
                        "malaria_diagnostic_procedure_grp/where_supplies_stored": random.choice(["nurse_office", "nurse_office", "store_room", "head_office"]),
                        "malaria_diagnostic_procedure_grp/notes_diagnostic_procedure": random.choice(["RDT for all suspected cases; severe cases referred to hospital", "Clinical diagnosis when RDTs out of stock", "No register kept; data missing for term 1", ""])})
        data["F"].append(rec)
    # G: 74 schools, 10 with a second submission
    for i, s in enumerate(recruited + random.sample(recruited, 10)):
        t = when(i); sid += 1
        data["G"].append({"_id": sid, "_uuid": f"g-{sid}", "_submission_time": ts(t + timedelta(hours=5)), "_submitted_by": "pa_sense",
                          "start": t.astimezone(EAT).isoformat(timespec="milliseconds"), "end": (t + timedelta(hours=6)).astimezone(EAT).isoformat(timespec="milliseconds"),
                          "School_Identification_grp/school_code": "SCH089" if i == 3 else s["code"], "School_Identification_grp/school_name": s["name"],
                          "School_Identification_grp/district": s["district"], "School_Identification_grp/region": s["region"],
                          "physical_infrastructure_grp/total_dormitories": random.randint(2, 12), "physical_infrastructure_grp/total_classrooms": random.randint(6, 30),
                          "physical_infrastructure_grp/total_quarters": random.randint(0, 20), "physical_infrastructure_grp/total_bathrooms": random.randint(4, 48),
                          "school_physical_infrastructure_grp/within_breeding_site": random.choice(["yes", "no"]), "school_physical_infrastructure_grp/outside_breeding_site": random.choice(["yes", "no"]),
                          "school_physical_infrastructure_grp/open_containers": random.choice(["yes", "no"]), "school_physical_infrastructure_grp/functional_drainage_sys": random.choice(["yes", "no"]),
                          "malaria_prevention_features_grp/irs_history": random.choice(["last12", "over12", "never", "never"]), "malaria_prevention_features_grp/history_pesticide_use": random.choice(["last12", "last12", "over12", "never"]),
                          "school_physical_infrastructure_grp/drainage_channel_end": random.choice(["soak_pit", "soak_pit", "open_drain", "other"]), "Respondent_signature_grp/notes_general_observations": "Head teacher Mr Okello was present",
                          "Classrooms_dormitories_grp": [{"Classrooms_dormitories_grp/structure_category": random.choice(["dormitory", "dormitory", "classroom", "quarters"]),
                                                          "Classrooms_dormitories_grp/wall_material": random.choice(["brick", "mud", "concrete"]), "Classrooms_dormitories_grp/roof_material": random.choice(["iron_sheets", "tiles", "thatch"]),
                                                          "Classrooms_dormitories_grp/dormitory_capacity": random.randint(20, 120), "Classrooms_dormitories_grp/presence_open_eaves": random.choice(["yes", "no"]),
                                                          "Classrooms_dormitories_grp/screened_windows": random.choice(["yes", "no"]), "Classrooms_dormitories_grp/bednets_hung": random.choice(["yes", "no"])} for _ in range(random.randint(1, 4))],
                          "Respondent_signature_grp/data_officer": random.choice(OFFICERS).lower(), "_attachments": [], "_geolocation": [None, None]})
    # G in two parts for one school (different days, different blocks) plus one exact re-send
    g0 = data["G"][0]
    part2 = {**g0, "_id": (sid := sid + 1), "_uuid": f"g-{sid}", "_submission_time": ts(when(3) + timedelta(days=1, hours=5)),
             "physical_infrastructure_grp/total_dormitories": 1, "physical_infrastructure_grp/total_classrooms": g0["physical_infrastructure_grp/total_classrooms"],
             "Classrooms_dormitories_grp": [{"Classrooms_dormitories_grp/structure_category": "dormitory", "Classrooms_dormitories_grp/wall_material": "brick", "Classrooms_dormitories_grp/roof_material": "iron_sheets",
                                              "Classrooms_dormitories_grp/dormitory_capacity": 80, "Classrooms_dormitories_grp/presence_open_eaves": "yes", "Classrooms_dormitories_grp/screened_windows": "no", "Classrooms_dormitories_grp/bednets_hung": "yes"}]}
    data["G"].append(part2)
    data["G"].append({**part2, "_id": (sid := sid + 1), "_uuid": f"g-{sid}", "_submission_time": ts(when(3) + timedelta(days=1, hours=6))})
    # H: 74 recruited (3 with region typed as district)
    for i, s in enumerate(recruited):
        t = when(i); sid += 1
        data["H"].append({"_id": sid, "_uuid": f"h-{sid}", "_submission_time": ts(t + timedelta(hours=5)), "_submitted_by": "pa_sense",
                          "start": t.astimezone(EAT).isoformat(timespec="milliseconds"), "end": (t + timedelta(minutes=random.choice([3, 40, 400]))).astimezone(EAT).isoformat(timespec="milliseconds"),
                          "School_location_info_grp/school_code": s["code"], "School_location_info_grp/school_name": s["name"],
                          "School_location_info_grp/district": s["region"] if i % 25 == 0 else s["district"],
                          "School_location_info_grp/region": s["region"], "School_location_info_grp/head_master": "HT Y",
                          "School_location_info_grp/hm_contact": f"07{random.randint(10000000, 99999999)}",
                          "School_location_info_grp/completion_date": t.date().isoformat(),
                          "Enrollment_data_grp": [{"Enrollment_data_grp/year": "2026", "Enrollment_data_grp/term": tm, "Enrollment_data_grp/total_school_enroll": (e := random.randint(300, 1500)),
                                                   "Enrollment_data_grp/total_boarders": int(e * random.uniform(0.4, 0.95)), "Enrollment_data_grp/total_malaria_cases": (c := random.randint(0, 120)),
                                                   "Enrollment_data_grp/confirmed_malaria": int(c * random.uniform(0.5, 1)), "Enrollment_data_grp/total_severe_cases": random.randint(0, 5),
                                                   "Enrollment_data_grp/total_rdt_used": c + random.randint(0, 60), "Enrollment_data_grp/total_act_used": c} for tm in (["t1", "t2"] if i % 3 else ["t1"])],
                          "data_officer": random.choice(OFFICERS).lower(), "_attachments": [], "_geolocation": [None, None]})
    # A: 48 assessments — 44 of recruited schools (name variants), 2 of unrecruited, 2 with blank district
    pool = random.sample(recruited, 44) + SCHOOLS[80:82]
    for i, s in enumerate(pool + [recruited[0], recruited[1]]):
        t = when(i) + timedelta(days=random.randint(1, 12)); sid += 1
        data["A"].append({"_id": sid, "_uuid": f"a-{sid}", "_submission_time": ts(t + timedelta(hours=3)), "_submitted_by": "pa_sense",
                          "start": t.astimezone(EAT).isoformat(timespec="milliseconds"), "end": (t + timedelta(minutes=3)).astimezone(EAT).isoformat(timespec="milliseconds"),
                          "School_assessment_grp/region": s["region"].lower(),
                          "School_assessment_grp/district": "" if i >= 46 else s["district"].lower().replace(" ", "_"),
                          "School_assessment_grp/school_name": variant(s["name"]), "School_assessment_grp/visit_date": t.date().isoformat(),
                          "School_assessment_grp/springfiles_received": "yes", "School_assessment_grp/consent_signed": random.choice(["yes", "no"]),
                          "School_assessment_grp/training_conducted": random.choice(["yes", "no"]), "School_assessment_grp/retros_data_collected": "yes",
                          "School_assessment_grp/data_officer": random.choice(OFFICERS).lower(), "_attachments": [], "_geolocation": [None, None]})
    base = {"_submitted_by": "pa_sense", "_attachments": [], "_geolocation": [None, None]}
    for i, d in enumerate(["hoima", "kiryandongo", "kikuube"]):
        sid += 1; t = datetime(2026, 10, 5, 6, 30, tzinfo=timezone.utc)
        data["DM"].append({**base, "_id": sid, "_uuid": f"dm-{sid}", "_submission_time": ts(t), "start": t.isoformat(), "end": (t + timedelta(minutes=9)).isoformat(),
                           "School_location_info_grp/district": d, "School_location_info_grp/district_code": "02", "School_location_info_grp/meeting_entry_date": "2026-09-29",
                           "School_location_info_grp/mous_signed": "yes", "School_location_info_grp/num_schools_attended": 7 + i, "School_location_info_grp/Entrant_Initials": "te"})
    for i, (d, n) in enumerate([("bukedea", 9), ("luwero", 20), ("karenga", 4)]):
        sid += 1; t = datetime(2026, 10, 2, 4, 0, tzinfo=timezone.utc)
        data["DE"].append({**base, "_id": sid, "_uuid": f"de-{sid}", "_submission_time": ts(t), "start": t.isoformat(), "end": (t + timedelta(minutes=5)).isoformat(),
                           "meeting_info_grp/district": d, "meeting_info_grp/district_code": "07", "meeting_info_grp/num_schools_mobilized": n, "meeting_info_grp/num_conf_attendance": n - 1})
    for d in ["gulu_city", "karenga"]:
        sid += 1; t = datetime(2026, 10, 3, 13, 0, tzinfo=timezone.utc)
        data["DP"].append({**base, "_id": sid, "_uuid": f"dp-{sid}", "_submission_time": ts(t), "start": t.isoformat(), "end": (t + timedelta(minutes=5)).isoformat(),
                           "meeting_info_grp/district": d, "meeting_info_grp/district_code": "01", "meeting_info_grp/list_schools_obtained": "yes",
                           "meeting_info_grp/entry_meeting_date": "2026-10-20", "meeting_info_grp/deo_name": "DEO PERSON", "meeting_info_grp/deo_contact": "0788000000"})
    # NL: weekly nurse-log summaries for ~70% of recruited schools over the last 7 weeks (one school stops
    # reporting, a few weeks are missed, a few are submitted twice, one code is not on the roster)
    logging = random.sample(recruited, int(len(recruited) * 0.7))
    today = datetime(2026, 10, 20, tzinfo=timezone.utc)
    monday = today - timedelta(days=today.weekday())
    for si, s in enumerate(logging + [{"code": "SCH999", "name": "UNKNOWN SS", "district": "LUWERO", "region": "BUGANDA"}]):
        base = random.uniform(2, 40)
        for wk in range(7):
            ws = monday - timedelta(days=7 * (6 - wk))
            if (si == 0 and wk > 3) or random.random() < 0.12:
                continue
            for copy in range(2 if random.random() < 0.05 else 1):
                sid += 1
                cb, cd = int(random.expovariate(1 / base)), int(random.expovariate(1 / (base / 3)))
                kb, kd = int(cb * random.uniform(0.6, 1)), int(cd * random.uniform(0.6, 1))
                sev = random.randint(0, 2) if kb + kd > 5 else 0
                data["NL"].append({"_id": sid, "_uuid": f"nl-{sid}", "_submission_time": ts(ws + timedelta(days=5 + copy, hours=10)), "_submitted_by": "nurse",
                                   "start": ws.isoformat(), "end": (ws + timedelta(minutes=6)).isoformat(),
                                   "school_info_grp/school_code": s["code"], "school_info_grp/school_name": s["name"], "school_info_grp/district": s["district"],
                                   "school_info_grp/nurse_name": "NURSE Z", "school_info_grp/nurse_contact": "0770000000",
                                   "period_grp/year": "2026", "period_grp/term": "t3", "period_grp/week_start_date": ws.date().isoformat(), "period_grp/week_end_date": (ws + timedelta(days=6)).date().isoformat(),
                                   "cases_grp/total_cases_boarders": cb, "cases_grp/confirmed_boarders": kb, "cases_grp/total_cases_day": cd, "cases_grp/confirmed_day": kd,
                                   "cases_grp/val_confirmed_cases_boarders": "1", "cases_grp/total_severe_cases": sev, "cases_grp/severe_cases_boarders": min(sev, kb),
                                   "supplies_grp/chk_mal_tests_treat": "yes", "supplies_grp/rdt_used": cb + cd + random.randint(0, 10), "supplies_grp/acts_used": kb + kd,
                                   "supplies_grp/artesunate_used": sev * 3, "supplies_grp/rdt_stock": "yes" if random.random() < 0.08 else "no", "supplies_grp/act_stock": "yes" if random.random() < 0.05 else "no",
                                   "supplies_grp/notified_stockout": "no", "absent_grp/chk_calibration_cohort_school": "yes" if si % 5 == 0 else "no",
                                   "absent_grp/ord_casedayslost_boarders": kb * 2, "absent_grp/ord_casedayslost_day": kd * 2, "absent_grp/sev_casedayslost_boarders": sev * 5, "absent_grp/sev_casedayslost_day": 0,
                                   "sign_grp/respond_attestation": "yes", "sign_grp/attestation_date": (ws + timedelta(days=5)).date().isoformat(), "sign_grp/data_officer": random.choice(OFFICERS).lower(),
                                   "_attachments": [], "_geolocation": [None, None]})
    # BL: termly bursar summaries for ~60% of recruited schools — Term 2 for most, Term 3 for a third
    for s in random.sample(recruited, int(len(recruited) * 0.6)):
        for tm in (["t2"] + (["t3"] if random.random() < 0.35 else [])):
            sid += 1
            enrol = random.randint(300, 1500); d = datetime(2026, 8, 14 if tm == "t2" else 10, tzinfo=timezone.utc) + timedelta(days=random.randint(0, 20))
            rq, aq, art = random.randint(2, 30), random.randint(20, 400), random.randint(0, 20)
            data["BL"].append({"_id": sid, "_uuid": f"bl-{sid}", "_submission_time": ts(d + timedelta(hours=12)), "_submitted_by": "bursar",
                               "start": d.isoformat(), "end": (d + timedelta(minutes=9)).isoformat(),
                               "school_info_grp/school_code": s["code"], "school_info_grp/school_name": s["name"], "school_info_grp/bursar_name": "BURSAR Y", "school_info_grp/bursar_contact": "0780000000",
                               "period_grp/year": "2026", "period_grp/term": tm, "period_grp/completion_date": d.date().isoformat(),
                               "enrol_grp/total_school_enroll": enrol, "enrol_grp/total_boarders": int(enrol * random.uniform(0.4, 0.95)), "enrol_grp/calc_total_day": "0",
                               "enrol_grp/first_insession_date": "2026-05-25" if tm == "t2" else "2026-09-14", "enrol_grp/last_insession_date": "2026-08-21" if tm == "t2" else "2026-12-04", "enrol_grp/calc_insession_days": "88" if tm == "t2" else "81",
                               "rdt_grp/chk_rdt_tests": "yes", "rdt_grp/rdt_qty": rq, "rdt_grp/rdt_type": random.choice(["bioline", "standard_q", "biocredit bioline"]), "rdt_grp/rdt_unit": "kits",
                               "rdt_grp/rdt_unitcost": random.choice([25000, 30000, 45000]), "rdt_grp/prev_rdt_stock": "no", "rdt_grp/prev_rdt_qty": 0,
                               "rdt_grp/chk_other_testing_costs": "yes" if random.random() < 0.3 else "no", "rdt_grp/other_testing_items": "gloves", "rdt_grp/other_testing_costs": random.choice([0, 0, 20000, 60000]),
                               "act_grp/act_qty": aq, "act_grp/act_brand_type": random.choice(["coartem", "lonart", "lumartem lonart"]), "act_grp/act_unit": "doses", "act_grp/act_unitcost": random.choice([3500, 5000, 8000]),
                               "act_grp/prev_act_stock": "no", "act_grp/prev_act_qty": 0, "severe_grp/chk_severe_mgt": "yes" if art else "no", "severe_grp/artesunate_qty": art, "severe_grp/artesunate_unitcost": 12000 if art else 0,
                               "severe_grp/other_malaria_tx_items": "", "severe_grp/other_malaria_tx_costs": random.choice([0, 0, 0, 150000]),
                               "sign_grp/respond_attestation": "yes", "sign_grp/attestation_date": d.date().isoformat(), "sign_grp/data_officer": random.choice(OFFICERS).lower(),
                               "_attachments": [], "_geolocation": [None, None]})
    for k in data:
        data[k].sort(key=lambda s: s["_id"])
    return data


DATA = build()
BY_UID = {uid: k for k, uid in UIDS.items()}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    def do_GET(self):
        if self.headers.get("Authorization") != "Token test":
            return self.send_json({"detail": "Invalid token."}, 401)
        u = urlparse(self.path); qs = parse_qs(u.query)
        parts = [p for p in u.path.split("/") if p]
        if len(parts) < 4 or parts[:3] != ["api", "v2", "assets"] or parts[3] not in BY_UID:
            return self.send_json({"detail": "not found"}, 404)
        uid, k, rest = parts[3], BY_UID[parts[3]], parts[4:]
        rows = DATA[k]
        if not rest:
            return self.send_json({"uid": uid, "name": f"SENSE mock form {k}", "deployment__active": True,
                                   "deployment__submission_count": len(rows), "version_id": "v1", "date_modified": "2026-10-01T00:00:00Z",
                                   "content": {"survey": SURVEYS[k], "choices": CHOICES}})
        if rest == ["data"]:
            limit = int(qs.get("limit", [100])[0]); start = int(qs.get("start", [0])[0])
            nxt = f"http://127.0.0.1:{PORT}/api/v2/assets/{uid}/data/?format=json&limit={limit}&start={start + limit}" if start + limit < len(rows) else None
            return self.send_json({"count": len(rows), "next": nxt, "previous": None, "results": rows[start:start + limit]})
        if rest == ["export-settings"]:
            return self.send_json({"count": 1, "results": [{"uid": "esMOCK", "name": "Default",
                "data_url_xlsx": f"http://127.0.0.1:{PORT}/api/v2/assets/{uid}/export-settings/esMOCK/data.xlsx",
                "data_url_csv": f"http://127.0.0.1:{PORT}/api/v2/assets/{uid}/export-settings/esMOCK/data.csv"}]})
        if len(rest) == 3 and rest[0] == "export-settings":
            body = b"PK\x03\x04 mock export " + uid.encode()
            self.send_response(200); self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body); return
        self.send_json({"detail": "not found"}, 404)


if __name__ == "__main__":
    print(f"mock Kobo on http://127.0.0.1:{PORT}", file=sys.stderr)
    HTTPServer(("127.0.0.1", PORT), H).serve_forever()
