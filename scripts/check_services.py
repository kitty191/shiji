"""Read-only local service probes. No authentication or database writes."""
import os
import socket


def mysql_probe():
    host = os.environ.get("MYSQL_HOST", "127.0.0.1")
    port = int(os.environ.get("MYSQL_PORT", "3306"))
    with socket.create_connection((host, port), timeout=3) as connection:
        connection.settimeout(3)
        header = read_exact(connection, 4)
        size = int.from_bytes(header[:3], "little")
        if not 1 <= size <= 65535:
            raise RuntimeError("unexpected handshake size")
        payload = read_exact(connection, size)
        if payload[0] != 10:
            raise RuntimeError("not a MySQL protocol-10 greeting")
        version = payload[1:].split(b"\0", 1)[0].decode("ascii", errors="replace")
        return f"MySQL: reachable; server {version}; database login NOT verified"


def read_exact(connection, size):
    chunks = bytearray()
    while len(chunks) < size:
        part = connection.recv(size - len(chunks))
        if not part:
            raise RuntimeError("connection closed before greeting completed")
        chunks.extend(part)
    return bytes(chunks)


def redis_probe():
    host = os.environ.get("REDIS_HOST", "127.0.0.1")
    port = int(os.environ.get("REDIS_PORT", "6379"))
    with socket.create_connection((host, port), timeout=3) as connection:
        connection.settimeout(3)
        connection.sendall(b"*1\r\n$4\r\nPING\r\n")
        reply = bytearray()
        while b"\r\n" not in reply and len(reply) < 4096:
            chunk = connection.recv(256)
            if not chunk:
                break
            reply.extend(chunk)
        if bytes(reply).startswith(b"+PONG\r\n"):
            return "Redis: PONG (no application keys read or written)"
        if bytes(reply).startswith(b"-NOAUTH"):
            raise RuntimeError("reachable; authentication required; credentials NOT checked")
        raise RuntimeError("unexpected PING reply")


def main():
    failed = False
    for name, probe in (("MySQL", mysql_probe), ("Redis", redis_probe)):
        try:
            print(probe())
        except (OSError, RuntimeError, ValueError) as error:
            failed = True
            print(f"{name}: {error}")
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
