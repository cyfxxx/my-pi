// 起始规则集（2026-10-10）——**故意写得极窄**，宁可漏报也不要制造假阳性
// （本会话的教训：会狼来了的检查必然被无视）
rule eicar_test_string
{
    meta:
        description = "业界标准杀毒测试串（EICAR）"
        severity = "test"
    strings:
        $e = "EICAR-STANDARD-ANTIVIRUS-TEST-FILE" ascii
    condition:
        $e
}

rule reverse_shell_bash_tcp
{
    meta:
        description = "bash 反弹 shell 的典型写法（/dev/tcp 或 nc -e）"
        severity = "high"
    strings:
        $a = "bash -i >& /dev/tcp/" ascii nocase
        $b = "nc -e /bin/" ascii nocase
        $c = "sh -i >& /dev/tcp/" ascii nocase
    condition:
        any of them
}

rule crypto_miner_indicators
{
    meta:
        description = "挖矿木马常见字符串（stratum 矿池协议 + 已知矿工名）"
        severity = "high"
    strings:
        $a = "stratum+tcp://" ascii nocase
        $b = "xmrig" ascii nocase
        $c = "minerd" ascii nocase
    condition:
        any of them
}

rule encoded_powershell_launch
{
    meta:
        description = "PowerShell 以 base64/隐藏窗口方式加载代码（常见投递手法）"
        severity = "medium"
    strings:
        $a = "-EncodedCommand" ascii nocase
        $b = "-w hidden" ascii nocase
        $c = "FromBase64String" ascii nocase
    condition:
        2 of them
}
