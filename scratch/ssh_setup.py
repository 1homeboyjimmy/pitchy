import paramiko
import sys

HOST = "193.187.94.144"
USER = "root"
PASS = "FL51k+UWmA"

def ssh_run(cmd, timeout=300):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS, timeout=30)
    
    print(f"\nCMD: {cmd}")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    exit_code = stdout.channel.recv_exit_status()
    
    if out: print(out)
    if err: print(f"STDERR: {err}")
    client.close()
    return out, err, exit_code

if __name__ == "__main__":
    ssh_run(" ".join(sys.argv[1:]))
