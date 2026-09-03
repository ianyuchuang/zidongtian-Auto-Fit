# -*- coding: utf-8 -*-
"""開通 Windows 防火牆的 TCP 8765，讓同一區網的同事連得到 dev_server.py --lan。

只做一次；要收回就照最後印出的指令刪掉規則。
必須用系統管理員身分執行（`0_開通防火牆(只做一次).bat` 會自己要求提權）。

規則預設只開「私人網路」。辦公室網路若被 Windows 歸成「公用網路」，規則不會生效
（同事會看到「回應時間過長」），這時要用 --any-profile 開在所有設定檔上。
腳本會自己偵測並詢問。

用法:
    python tools/open_firewall.py                # 加規則（只開私人網路）
    python tools/open_firewall.py --any-profile  # 所有網路設定檔都開
    python tools/open_firewall.py --remove       # 刪規則
"""
import argparse
import ctypes
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dev_server import lan_ip  # noqa: E402

RULE_NAME = "AutoFit-LAN-8765"  # 不放空白，命令列引號少一層就少一個出錯機會
PORT = 8765


def add_rule_cmd(rule=RULE_NAME, port=PORT, profile="private"):
    """profile='private' 只開私人網路；'any' 連公用網路也開。"""
    return [
        "netsh", "advfirewall", "firewall", "add", "rule",
        f"name={rule}", "dir=in", "action=allow",
        "protocol=TCP", f"localport={port}", f"profile={profile}",
    ]


def delete_rule_cmd(rule=RULE_NAME):
    return ["netsh", "advfirewall", "firewall", "delete", "rule", f"name={rule}"]


def network_profiles():
    """回傳 [(IPv4, NetworkCategory)]，例如 [("192.168.1.95", "Public"), ("100.x.x.x", "Private")]。

    要對到「實際在用的那張網卡」。只問「有沒有任何一張是 Private」會被騙：
    Tailscale / VMware / Hyper-V 的虛擬網卡常常是 Private，但同事走的是乙太網路那張。

    拿不到就回空 list —— 寧可少講一句話，也不要卡住整支腳本。
    """
    ps = (
        "Get-NetConnectionProfile | ForEach-Object { "
        "$i=$_.InterfaceIndex; $c=$_.NetworkCategory; "
        "Get-NetIPAddress -InterfaceIndex $i -AddressFamily IPv4 -ErrorAction SilentlyContinue | "
        "ForEach-Object { \"$($_.IPAddress),$c\" } }"
    )
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps],
            capture_output=True, text=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    out = []
    for line in r.stdout.splitlines():
        ip, _, cat = line.strip().partition(",")
        if ip and cat:
            out.append((ip, cat))
    return out


def category_for_ip(profiles, ip):
    """那個 IP 所在網卡的類別；對不到回 None。"""
    for addr, cat in profiles:
        if addr == ip:
            return cat
    return None


def private_profile_is_enough(profiles, ip):
    """同事要連的那個 IP，它那張網卡是私人 / 網域，profile=private 的規則才對得上。"""
    cat = category_for_ip(profiles, ip)
    if cat is None:
        return True  # 偵測不到就別亂猜，維持保守的預設
    return cat in ("Private", "DomainAuthenticated")


def is_admin():
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except AttributeError:  # 非 Windows
        return False


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--remove", action="store_true", help="改成刪掉規則")
    ap.add_argument("--any-profile", action="store_true",
                    help="所有網路設定檔都開（辦公室網路被歸成「公用網路」時要這個）")
    args = ap.parse_args(argv)

    if sys.platform != "win32":
        print("[X] 這支只在 Windows 上有用。")
        return 1
    if not is_admin():
        print("[X] 權限不夠。請在 .bat 上按右鍵 →「以系統管理員身分執行」。")
        return 1

    if args.remove:
        rc = subprocess.run(delete_rule_cmd(), capture_output=True, text=True).returncode
        print("  已刪掉規則。" if rc == 0 else f"  沒有這條規則可刪（{RULE_NAME}）。")
        return 0

    ip = lan_ip()
    profile = "any" if args.any_profile else "private"
    if profile == "private":
        profiles = network_profiles()
        if not private_profile_is_enough(profiles, ip):
            cat = category_for_ip(profiles, ip)
            print(f"  同事要連的 {ip} 那張網卡被 Windows 歸成「{cat}」，不是私人網路。")
            print("  只開私人網路的規則不會生效，同事會看到「回應時間過長」。")
            ans = input("  要改成所有網路設定檔都開嗎？(y/N) ").strip().lower()
            if ans in ("y", "yes"):
                profile = "any"
            else:
                print("  好，維持只開私人網路。連不到的話再跑一次選 y。")

    # 先刪再加，重複執行才不會疊出一堆同名規則
    subprocess.run(delete_rule_cmd(), capture_output=True, text=True)
    r = subprocess.run(add_rule_cmd(profile=profile), capture_output=True, text=True)
    if r.returncode != 0:
        print(f"[X] 加規則失敗：{(r.stderr or r.stdout).strip()}")
        return 1

    scope = "所有網路設定檔" if profile == "any" else "只開私人網路"
    print(f"  [OK] 已開通 TCP {PORT}（{scope}）。")
    print()
    if ip:
        print(f"  你的內網位址：{ip}")
        print(f"  要給同事的網址：http://{ip}:{PORT}/")
    else:
        print("  抓不到內網 IP，請自己跑 ipconfig 看「IPv4 位址」。")
    print()
    print("  接下來雙擊「4_架設到內網.bat」開站。同事第一次要設 Chrome 旗標，")
    print("  步驟見 docs\\內網測試.md。")
    print()
    print(f"  之後想收回：以系統管理員身分執行 python tools\\open_firewall.py --remove")
    return 0


if __name__ == "__main__":
    sys.exit(main())
