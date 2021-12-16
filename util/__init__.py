import json
from typing import List
from json_flatten import unflatten
from requests_toolbelt.utils import dump


def changes(equipment: List[object], fields: List[str]):
    output = []
    fields = ["id", "id$int"] + fields
    for piece in equipment:
        change = {}
        for field in fields:
            if field in piece:
                change[field] = piece[field]
                if field.startswith("customField"):
                    for key in piece.keys():
                        if key.startswith(".".join(field.split(".")[0:2])):
                            change[key] = piece[key]
        output.append(unflatten(change))
    return output


def status_report(results, responses, total_possible, reqs: List[object]) -> List[dict]:
    responses_out = []

    # Create a status report
    count = 0
    for resp in responses:
        count = count + 1
        content = json.loads(resp.response.content.decode("utf-8"))
        responses_out.append(content)
        if resp.response.status_code < 300:
            results["success"] += 1
            results["successes"].append(content)
        else:
            results["fail"] += 1
            # data = dump.dump_all(resp)
            # print(data.decode("utf-8"))
            content.update({"request": reqs[count]})
            results["failures"].append(content)

    results["not_created"] = int(total_possible) - (results["success"] + results["fail"])
    print(json.dumps(results, indent=2))

    return responses_out
