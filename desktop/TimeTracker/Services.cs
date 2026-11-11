using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace TimeTracker
{
    // ---------- device identity ----------

    public static class DeviceInfo
    {
        private static readonly string[] VirtualHints =
            { "virtual", "vmware", "hyper-v", "vpn", "tap-", "wintun", "wireguard", "bluetooth", "loopback", "tunnel", "pseudo", "npcap", "docker" };

        /// <summary>MAC addresses of the real network cards, the most stable one first (wired, then Wi-Fi).</summary>
        public static List<string> GetMacs()
        {
            var found = new List<Tuple<int, string>>();
            try
            {
                foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    bool wired = ni.NetworkInterfaceType == NetworkInterfaceType.Ethernet || ni.NetworkInterfaceType == NetworkInterfaceType.GigabitEthernet;
                    bool wifi = ni.NetworkInterfaceType == NetworkInterfaceType.Wireless80211;
                    if (!wired && !wifi) continue;
                    string desc = (ni.Description + " " + ni.Name).ToLowerInvariant();
                    if (VirtualHints.Any(desc.Contains)) continue;
                    byte[] b = ni.GetPhysicalAddress().GetAddressBytes();
                    if (b.Length != 6 || b.All(x => x == 0)) continue;
                    bool locallyAdministered = (b[0] & 2) != 0; // randomised or software-assigned address: least trustworthy
                    int rank = (locallyAdministered ? 10 : 0) + (wired ? 0 : 1);
                    found.Add(Tuple.Create(rank, string.Join(":", b.Select(x => x.ToString("X2")))));
                }
            }
            catch { }
            return found.OrderBy(x => x.Item1).ThenBy(x => x.Item2).Select(x => x.Item2).Distinct().ToList();
        }

        /// <summary>The Windows installation id. Unlike a MAC address it cannot be changed from network settings.</summary>
        public static string GetMachineId(List<string> macs)
        {
            try
            {
                using (var hklm = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
                using (var key = hklm.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography"))
                {
                    var v = key == null ? null : key.GetValue("MachineGuid") as string;
                    if (!string.IsNullOrWhiteSpace(v)) return v.Trim();
                }
            }
            catch { }
            return macs.Count > 0 ? "mac-" + macs[0] : "";
        }

        public static string OsName()
        {
            var v = Environment.OSVersion.Version;
            string name = v.Major == 10 ? (v.Build >= 22000 ? "Windows 11" : "Windows 10") : "Windows " + v.Major + "." + v.Minor;
            return name + " (build " + v.Build + ")";
        }
    }

    // ---------- server API ----------

    public sealed class ApiException : Exception
    {
        public readonly int Status;   // 0 = could not reach the server
        public readonly string Code;
        public ApiException(int status, string message, string code = null) : base(message) { Status = status; Code = code; }
        public bool IsAuthFailure { get { return Status == 401 || Status == 403; } }
    }

    public sealed class Api
    {
        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };

        public string BaseUrl = "";
        public string Token;

        public static string NormalizeUrl(string url)
        {
            url = (url ?? "").Trim().TrimEnd('/');
            if (url.Length == 0) return "";
            if (!url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                url = "https://" + url;
            return url;
        }

        private async Task<Dictionary<string, object>> Send(HttpMethod method, string path, object body)
        {
            string text;
            int status;
            try
            {
                using (var req = new HttpRequestMessage(method, BaseUrl + "/api" + path))
                {
                    if (!string.IsNullOrEmpty(Token)) req.Headers.TryAddWithoutValidation("Authorization", "Bearer " + Token);
                    if (body != null) req.Content = new StringContent(Json.Serialize(body), Encoding.UTF8, "application/json");
                    using (var res = await Http.SendAsync(req).ConfigureAwait(false))
                    {
                        status = (int)res.StatusCode;
                        text = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
                    }
                }
            }
            catch (Exception)
            {
                throw new ApiException(0, "Cannot reach the server. Check the server address and your internet connection.");
            }

            Dictionary<string, object> data = null;
            try { data = Json.Deserialize<Dictionary<string, object>>(text); } catch { }
            if (status >= 200 && status < 300 && data != null) return data;
            if (data == null) throw new ApiException(status >= 400 ? status : 0, "Unexpected answer from the server (" + status + "). Check the server address.");
            throw new ApiException(status, Str(data, "error") ?? ("Request failed (" + status + ")"), Str(data, "code"));
        }

        public static string Str(Dictionary<string, object> d, string key)
        {
            object v;
            return d != null && d.TryGetValue(key, out v) && v != null ? v.ToString() : null;
        }

        public static int Int(Dictionary<string, object> d, string key)
        {
            object v;
            try { return d != null && d.TryGetValue(key, out v) && v != null ? Convert.ToInt32(v) : 0; } catch { return 0; }
        }

        public Task<Dictionary<string, object>> Login(string email, string password, List<string> macs, string machineId)
        {
            return Send(HttpMethod.Post, "/desktop/login", new Dictionary<string, object>
            {
                { "email", email }, { "password", password }, { "macs", macs }, { "machineId", machineId },
                { "hostname", Environment.MachineName }, { "os", DeviceInfo.OsName() },
            });
        }

        public Task<Dictionary<string, object>> Upload(List<MinuteBucket> minutes)
        {
            var list = minutes.Select(b => new Dictionary<string, object> { { "t", b.T }, { "s", b.S }, { "m", b.M }, { "k", b.K } }).ToList();
            return Send(HttpMethod.Post, "/desktop/activity", new Dictionary<string, object> { { "minutes", list } });
        }

        public Task<Dictionary<string, object>> Summary(DateTime dayStartUtc, DateTime weekStartUtc)
        {
            return Send(HttpMethod.Get, "/desktop/summary?dayStart=" + Uri.EscapeDataString(dayStartUtc.ToString("o")) +
                                        "&weekStart=" + Uri.EscapeDataString(weekStartUtc.ToString("o")), null);
        }
    }

    // ---------- local files: %APPDATA%\TimeTracker ----------

    public sealed class Store
    {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        private readonly string _dir;

        public string Server = "", Email = "", Name = "", Token;

        public Store()
        {
            _dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "TimeTracker");
            try { Directory.CreateDirectory(_dir); } catch { }
            Load();
        }

        private string SettingsPath { get { return Path.Combine(_dir, "settings.json"); } }

        private string QueuePath(string email)
        {
            using (var sha = SHA1.Create())
            {
                string h = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes((email ?? "").ToLowerInvariant()))).Replace("-", "").Substring(0, 12);
                return Path.Combine(_dir, "queue-" + h + ".json");
            }
        }

        private void Load()
        {
            try
            {
                if (File.Exists(SettingsPath))
                {
                    var d = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(SettingsPath));
                    Server = Api.Str(d, "server") ?? "";
                    Email = Api.Str(d, "email") ?? "";
                    Name = Api.Str(d, "name") ?? "";
                    string enc = Api.Str(d, "token");
                    if (!string.IsNullOrEmpty(enc)) // the token is encrypted for the current Windows account
                        Token = Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(enc), null, DataProtectionScope.CurrentUser));
                }
            }
            catch { Token = null; }

            // An admin can ship a server.txt next to the .exe so users never type the address.
            if (string.IsNullOrEmpty(Server))
            {
                try
                {
                    string preset = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "server.txt");
                    if (File.Exists(preset)) Server = Api.NormalizeUrl(File.ReadAllText(preset));
                }
                catch { }
            }
        }

        public void Save()
        {
            try
            {
                string enc = string.IsNullOrEmpty(Token) ? "" :
                    Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(Token), null, DataProtectionScope.CurrentUser));
                WriteAtomic(SettingsPath, Json.Serialize(new Dictionary<string, object> { { "server", Server }, { "email", Email }, { "name", Name }, { "token", enc } }));
            }
            catch { }
        }

        /// <summary>Minutes tracked while offline (or not uploaded before the app closed) for this account.</summary>
        public List<MinuteBucket> LoadQueue(string email)
        {
            var list = new List<MinuteBucket>();
            try
            {
                string p = QueuePath(email);
                if (!File.Exists(p)) return list;
                foreach (var row in Json.Deserialize<List<int[]>>(File.ReadAllText(p)))
                    if (row != null && row.Length == 4) list.Add(new MinuteBucket { T = row[0], S = row[1], M = row[2], K = row[3] });
            }
            catch { }
            return list;
        }

        public void SaveQueue(string email, List<MinuteBucket> queue)
        {
            try
            {
                WriteAtomic(QueuePath(email), Json.Serialize(queue.Select(b => new long[] { b.T, b.S, b.M, b.K }).ToList()));
            }
            catch { }
        }

        private static void WriteAtomic(string path, string content)
        {
            string tmp = path + ".tmp";
            File.WriteAllText(tmp, content);
            if (File.Exists(path)) File.Delete(path);
            File.Move(tmp, path);
        }
    }
}
