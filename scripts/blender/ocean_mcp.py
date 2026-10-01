"""Send Ocean authoring scripts to the running Blender MCP addon on localhost.

Uses the addon's existing execute_code protocol; Blender remains the authoring
and glTF export process. Responses can be kept beside the visual verification.
"""
import argparse
import json
from pathlib import Path
import socket


def request(command, params, timeout=60):
    with socket.create_connection(("127.0.0.1", 9876), timeout=10) as connection:
        connection.settimeout(timeout)
        connection.sendall(json.dumps({"type": command, "params": params}).encode("utf-8"))
        payload = bytearray()
        while True:
            part = connection.recv(262144)
            if not part:
                raise RuntimeError("Blender MCP closed before returning a JSON response")
            payload.extend(part)
            try:
                return json.loads(payload)
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--code-file", type=Path)
    parser.add_argument("--build-script", type=Path)
    parser.add_argument("--call-script", type=Path)
    parser.add_argument("--function")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--result", type=Path)
    args = parser.parse_args()
    if args.call_script:
        if not args.function:
            parser.error("--call-script requires --function")
        script_path = json.dumps(str(args.call_script.resolve()))
        function_name = json.dumps(args.function)
        code = ("import runpy,json\n"
                f"ocean_author = runpy.run_path({script_path})\n"
                f"print(json.dumps(ocean_author[{function_name}]()))\n")
        response = request("execute_code", {"code": code})
    elif args.build_script:
        if not args.output_dir:
            parser.error("--build-script requires --output-dir")
        script_path = json.dumps(str(args.build_script.resolve()))
        output_path = json.dumps(str(args.output_dir.resolve()))
        code = ("import runpy,json\n"
                f"ocean_author = runpy.run_path({script_path})\n"
                f"ocean_manifest = ocean_author['build_assets']({output_path})\n"
                "print(json.dumps(ocean_manifest))\n")
        response = request("execute_code", {"code": code})
    elif args.code_file:
        response = request("execute_code", {"code": args.code_file.read_text(encoding="utf-8")})
    else:
        response = request("get_scene_info", {})
    if args.result:
        args.result.parent.mkdir(parents=True, exist_ok=True)
        args.result.write_text(json.dumps(response, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(response, ensure_ascii=True))
    if response.get("status") != "success" or response.get("result", {}).get("executed") is False:
        raise SystemExit(1)
