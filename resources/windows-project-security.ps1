$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using Microsoft.Win32.SafeHandles;

public sealed class ProjectSecurityLease : IDisposable {
    [StructLayout(LayoutKind.Sequential)]
    struct Info {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Created, Accessed, Written;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct RenameInfo {
        public int Replace;
        public IntPtr Root;
        public uint Length;
        public char Name;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetFileInformationByHandle(SafeFileHandle file, out Info info);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetFileInformationByHandle(SafeFileHandle file, int type, IntPtr info, uint size);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern uint GetSecurityInfo(SafeFileHandle file, int type, uint sections, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("kernel32.dll")]
    static extern IntPtr LocalFree(IntPtr memory);
    readonly List<SafeFileHandle> directories = new List<SafeFileHandle>();
    FileStream temporary;
    string target, descriptor, originalId;
    public string DirectoryIds { get; private set; }
    public string TemporaryId { get { return Id(temporary.SafeFileHandle); } }
    const AccessControlSections Sections = AccessControlSections.Access | AccessControlSections.Owner | AccessControlSections.Group;
    const uint ReadDataAndSecurity = 0x80020000, OpenExisting = 3, OpenReparsePoint = 0x200000, OpenDirectory = 0x2000000;
    const uint ReparsePoint = 0x400, DirectoryAttribute = 0x10, Encrypted = 0x4000, ReadOnly = 1;
    const uint IntegrityLabel = 0x10, ResourceAttributes = 0x20, CentralAccessPolicy = 0x40;

    static Info Information(SafeFileHandle file) {
        Info info;
        if (!GetFileInformationByHandle(file, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return info;
    }
    static string Id(SafeFileHandle file) {
        Info info = Information(file);
        return (((ulong)info.IndexHigh << 32) | info.IndexLow).ToString();
    }
    static void Regular(SafeFileHandle file) {
        Info info = Information(file);
        if ((info.Attributes & (ReparsePoint | DirectoryAttribute | Encrypted)) != 0 || info.Links != 1) throw new IOException("Unsupported project file identity or encryption.");
    }
    static FileStream ReadTarget(string path) {
        SafeFileHandle handle = CreateFile(path, ReadDataAndSecurity, 7, IntPtr.Zero, OpenExisting, OpenReparsePoint, IntPtr.Zero);
        if (handle.IsInvalid) { int error = Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(error); }
        try { Regular(handle); return new FileStream(handle, FileAccess.Read); }
        catch { handle.Dispose(); throw; }
    }
    static string Descriptor(FileStream file) {
        IntPtr owner, group, dacl, sacl, descriptor;
        uint error = GetSecurityInfo(file.SafeFileHandle, 1, IntegrityLabel | ResourceAttributes | CentralAccessPolicy, out owner, out group, out dacl, out sacl, out descriptor);
        if (error != 0) throw new Win32Exception((int)error);
        try {
            if (sacl != IntPtr.Zero && Marshal.ReadInt16(sacl, 4) != 0) throw new IOException("Project has unsupported integrity labels or central access policy.");
        } finally { if (descriptor != IntPtr.Zero) LocalFree(descriptor); }
        FileSecurity acl = file.GetAccessControl();
        if (!acl.AreAccessRulesCanonical) throw new IOException("Unsupported noncanonical project permissions.");
        RawSecurityDescriptor raw = new RawSecurityDescriptor(acl.GetSecurityDescriptorBinaryForm(), 0);
        raw.SetFlags(raw.ControlFlags & ~(ControlFlags.DiscretionaryAclAutoInherited | ControlFlags.DiscretionaryAclAutoInheritRequired));
        return raw.GetSddlForm(Sections);
    }
    public ProjectSecurityLease(string path) {
        target = Path.GetFullPath(path);
        if (target.Length < 4 || target[1] != ':' || target.Substring(2).Contains(":")) throw new IOException("Only ordinary local file paths are supported.");
        DriveInfo drive = new DriveInfo(Path.GetPathRoot(target));
        if (drive.DriveType == DriveType.Network || drive.DriveFormat != "NTFS") throw new IOException("Secure ordinary Save requires a local NTFS volume.");
        List<string> parents = new List<string>();
        DirectoryInfo parent = Directory.GetParent(target);
        while (parent != null) { parents.Add(parent.FullName); parent = parent.Parent; }
        parents.Reverse();
        List<string> ids = new List<string>();
        try {
            foreach (string directory in parents) {
                SafeFileHandle handle = CreateFile(directory, 0, 3, IntPtr.Zero, OpenExisting, OpenDirectory | OpenReparsePoint, IntPtr.Zero);
                if (handle.IsInvalid) { int error = Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(error); }
                directories.Add(handle);
                Info info = Information(handle);
                if ((info.Attributes & ReparsePoint) != 0 || (info.Attributes & DirectoryAttribute) == 0) throw new IOException("Linked project directories are unsupported.");
                ids.Add(info.Volume.ToString() + ":" + Id(handle));
            }
            DirectoryIds = String.Join("/", ids);
            using (FileStream file = ReadTarget(target)) { originalId = Id(file.SafeFileHandle); descriptor = Descriptor(file); }
        } catch { Dispose(); throw; }
    }
    public string Security { get { return descriptor; } }
    public string FileId { get { return originalId; } }
    void CheckTarget() {
        using (FileStream file = ReadTarget(target)) {
            if (Id(file.SafeFileHandle) != originalId || Descriptor(file) != descriptor) throw new IOException("Project identity or permissions changed. Reopen it or use Save As.");
            if ((Information(file.SafeFileHandle).Attributes & ReadOnly) != 0) throw new IOException("The project is read-only.");
        }
    }
    public void Prepare(string path, string expectedSecurity, string expectedId, string expectedDirectories) {
        if (descriptor != expectedSecurity || originalId != expectedId || DirectoryIds != expectedDirectories) throw new IOException("Project identity or permissions changed. Reopen it or use Save As.");
        if (Path.GetDirectoryName(Path.GetFullPath(path)) != Path.GetDirectoryName(target)) throw new IOException("Temporary directory mismatch.");
        CheckTarget();
        FileSecurity security = new FileSecurity();
        security.SetSecurityDescriptorSddlForm(descriptor, Sections);
        temporary = new FileStream(path, FileMode.CreateNew, FileSystemRights.Read | FileSystemRights.Write | FileSystemRights.Delete | FileSystemRights.ReadPermissions, FileShare.ReadWrite, 4096, FileOptions.None, security);
        Regular(temporary.SafeFileHandle);
        if (temporary.Length != 0 || Descriptor(temporary) != descriptor) throw new IOException("Temporary permissions cannot preserve the project security descriptor.");
    }
    public void Replace() {
        CheckTarget();
        Regular(temporary.SafeFileHandle);
        if (Descriptor(temporary) != descriptor) throw new IOException("Temporary project permissions changed.");
        byte[] name = System.Text.Encoding.Unicode.GetBytes(target);
        int offset = Marshal.OffsetOf(typeof(RenameInfo), "Name").ToInt32();
        int size = offset + name.Length + 2;
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try {
            for (int i = 0; i < size; i++) Marshal.WriteByte(buffer, i, 0);
            Marshal.WriteInt32(buffer, 1);
            Marshal.WriteInt32(buffer, Marshal.OffsetOf(typeof(RenameInfo), "Length").ToInt32(), name.Length);
            Marshal.Copy(name, 0, IntPtr.Add(buffer, offset), name.Length);
            if (!SetFileInformationByHandle(temporary.SafeFileHandle, 3, buffer, (uint)size)) throw new Win32Exception(Marshal.GetLastWin32Error());
        } finally { Marshal.FreeHGlobal(buffer); }
        if (Descriptor(temporary) != descriptor) throw new IOException("Replacement security could not be verified.");
        using (FileStream file = ReadTarget(target)) {
            if (Id(file.SafeFileHandle) != TemporaryId || Descriptor(file) != descriptor) throw new IOException("Replacement identity or security could not be verified.");
        }
    }
    public bool HasTemporary { get { return temporary != null; } }
    public void Dispose() {
        if (temporary != null) { temporary.Dispose(); temporary = null; }
        foreach (SafeFileHandle directory in directories) directory.Dispose();
        directories.Clear();
    }
}
'@
$lease = $null
$stage = 'inspect'
try {
    $request = [Console]::ReadLine() | ConvertFrom-Json
    $lease = [ProjectSecurityLease]::new($request.path)
    if ($request.kind -eq 'inspect') {
        @{kind='snapshot'; security=$lease.Security; fileId=$lease.FileId; directories=$lease.DirectoryIds} | ConvertTo-Json -Compress | ForEach-Object { [Console]::WriteLine($_) }
    } elseif ($request.kind -eq 'prepare') {
        $stage = 'prepare'
        $lease.Prepare($request.temporary, $request.security, $request.fileId, $request.directories)
        @{kind='prepared'; fileId=$lease.TemporaryId} | ConvertTo-Json -Compress | ForEach-Object { [Console]::WriteLine($_) }
        [Console]::Out.Flush()
        $command = [Console]::ReadLine()
        if ($command -eq 'replace') {
            $stage = 'replace'
            $lease.Replace()
            [Console]::WriteLine('{"kind":"replaced"}')
        } elseif ($command -ne 'abort' -and $null -ne $command) { throw 'Invalid security helper command.' }
    } else { throw 'Invalid security helper request.' }
} catch {
    $cause = $_.Exception
    while ($cause.InnerException) { $cause = $cause.InnerException }
    $code = if ($cause -is [ComponentModel.Win32Exception]) { $cause.NativeErrorCode } else { $cause.HResult }
    @{kind='error'; stage=$stage; code=$code; created=($null -ne $lease -and $lease.HasTemporary)} | ConvertTo-Json -Compress | ForEach-Object { [Console]::WriteLine($_) }
} finally { if ($null -ne $lease) { $lease.Dispose() } }
