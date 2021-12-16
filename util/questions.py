import os, json
from typing import List, Literal
from PyInquirer import prompt
from pydash import head

DEFAULT_FIELDS = os.getenv("DEFAULT_FIELDS", "")


def which_buildings(buildings: List):
    questions = [
        {
            "type": "checkbox",
            "message": "Which buildings would you like to update?",
            "name": "UPDATE_BUILDINGS",
            "choices": [{"name": "- ALL BUILDINGS -", "value": {"name": "all"}}] + buildings,
        },
    ]
    return prompt(questions)["UPDATE_BUILDINGS"]


def which_fields(building_equipment: List, type: Literal["update", "upload"] = "update"):
    first = head(building_equipment)
    possible_fields = [
        {"name": first[key], "value": key, "checked": first[key] in DEFAULT_FIELDS}
        if key.startswith("customFields")
        else {"name": key, "value": key, "checked": key in DEFAULT_FIELDS}
        for key in first.keys()
        if (
            (not key.startswith("customFields") and key != "id")
            or (key.startswith("customFields") and key.endswith("name"))
        )
    ]
    questions = [
        {
            "type": "checkbox",
            "message": f"Which fields would you like to include in the {type}?",
            "name": "FIELDS",
            "choices": possible_fields,
        },
    ]
    return prompt(questions)["FIELDS"]


def do_add(not_created_count: int):
    questions = [
        {
            "type": "confirm",
            "name": "ADD_EQUIPMENT",
            "message": f"Would you like to add ({not_created_count}) items?",
            "default": False,
        }
    ]
    return prompt(questions)["ADD_EQUIPMENT"]
