// File System Access API 权限方法补充声明
// （当前 TS lib.dom 版本未包含 handle.queryPermission / requestPermission）

export {};

declare global {
  type FsaPermissionOptions = {
    mode?: "read" | "readwrite";
  };

  interface FileSystemHandle {
    queryPermission?(descriptor?: FsaPermissionOptions): Promise<PermissionState>;
    requestPermission?(descriptor?: FsaPermissionOptions): Promise<PermissionState>;
  }
}
