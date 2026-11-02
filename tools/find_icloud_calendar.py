#!/usr/bin/env python3
"""iCloud 캘린더 주소(ICLOUD_CALENDAR_URL)를 찾는 1회용 스크립트.

Apps Script 는 CalDAV 의 PROPFIND 요청을 보낼 수 없어서, 캘린더 주소만 이 스크립트로 미리 찾는다.
표준 라이브러리만 사용하므로 PC, 갤럭시탭(Termux), Google Colab 어디서나 실행된다.

    python3 find_icloud_calendar.py

Apple ID 와 앱 전용 암호(appleid.apple.com → 로그인 및 보안 → 앱 암호)를 물어본다.
입력한 정보는 iCloud 서버(caldav.icloud.com)로만 전송되고 저장되지 않는다.
"""

import base64
import getpass
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

NS = {"d": "DAV:", "c": "urn:ietf:params:xml:ns:caldav"}
START_URL = "https://caldav.icloud.com/"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def propfind(url, auth, body, depth):
    """PROPFIND 를 보내고 (최종 URL, XML 루트)를 돌려준다. 리다이렉트는 같은 메서드로 따라간다."""
    for _ in range(5):
        req = urllib.request.Request(
            url,
            data=body.encode("utf-8"),
            method="PROPFIND",
            headers={
                "Authorization": auth,
                "Depth": depth,
                "Content-Type": "application/xml; charset=utf-8",
            },
        )
        try:
            with OPENER.open(req, timeout=30) as res:
                return url, ET.fromstring(res.read())
        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 307, 308) and e.headers.get("Location"):
                url = urllib.parse.urljoin(url, e.headers["Location"])
                continue
            if e.code == 401:
                sys.exit("인증 실패: Apple ID 또는 앱 전용 암호를 확인하세요.")
            sys.exit(f"요청 실패: HTTP {e.code} ({url})")
    sys.exit("리다이렉트가 너무 많습니다.")


def first_href(root, prop_path):
    el = root.find(f".//d:prop/{prop_path}/d:href", NS)
    if el is None or not el.text:
        sys.exit(f"응답에서 {prop_path} 를 찾지 못했습니다.")
    return el.text.strip()


def clean_url(url):
    return url.replace(":443/", "/")


def main():
    apple_id = input("Apple ID (이메일): ").strip()
    password = getpass.getpass("앱 전용 암호 (xxxx-xxxx-xxxx-xxxx): ").strip()
    auth = "Basic " + base64.b64encode(f"{apple_id}:{password}".encode()).decode()

    url, root = propfind(
        START_URL, auth,
        '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>',
        "0",
    )
    principal = urllib.parse.urljoin(url, first_href(root, "d:current-user-principal"))

    url, root = propfind(
        principal, auth,
        '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
        "<d:prop><c:calendar-home-set/></d:prop></d:propfind>",
        "0",
    )
    home = urllib.parse.urljoin(url, first_href(root, "c:calendar-home-set"))

    url, root = propfind(
        home, auth,
        '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
        "<d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/></d:prop>"
        "</d:propfind>",
        "1",
    )

    calendars = []
    for resp in root.findall("d:response", NS):
        if resp.find(".//d:resourcetype/c:calendar", NS) is None:
            continue
        comps = [c.get("name") for c in resp.findall(".//c:supported-calendar-component-set/c:comp", NS)]
        if comps and "VEVENT" not in comps:
            continue  # 미리알림(VTODO) 목록 등은 제외
        name = resp.findtext(".//d:displayname", default="(이름 없음)", namespaces=NS)
        href = urllib.parse.urljoin(url, resp.findtext("d:href", namespaces=NS).strip())
        calendars.append((name, clean_url(href)))

    if not calendars:
        sys.exit("일정용 캘린더를 찾지 못했습니다.")

    print("\n찾은 캘린더 — 원하는 캘린더의 주소를 ICLOUD_CALENDAR_URL 에 넣으세요:\n")
    for name, href in calendars:
        print(f"  [{name}]\n  {href}\n")


if __name__ == "__main__":
    main()
