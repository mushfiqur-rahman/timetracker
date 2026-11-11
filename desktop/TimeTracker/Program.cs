using System;
using System.Net;
using System.Threading;
using System.Windows.Forms;

namespace TimeTracker
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            bool first;
            using (new Mutex(true, "TimeTracker.SingleInstance.7c1f", out first))
            {
                if (!first)
                {
                    MessageBox.Show("Time Tracker is already running. Look for its round icon next to the clock.", "Time Tracker",
                        MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainForm());
            }
        }
    }
}
