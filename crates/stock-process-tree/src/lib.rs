#[cfg(target_os = "windows")]
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};

#[cfg(target_os = "windows")]
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

#[cfg(target_os = "windows")]
#[derive(Debug)]
pub struct StockProcessTree {
    job: OwnedHandle,
}

#[cfg(target_os = "windows")]
impl StockProcessTree {
    pub fn attach(process_id: u32) -> Result<Self, String> {
        let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if job.is_null() {
            return Err(format!(
                "create Windows Job Object: {}",
                std::io::Error::last_os_error()
            ));
        }
        let job = unsafe { OwnedHandle::from_raw_handle(job) };

        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                job.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            return Err(format!(
                "configure Windows Job Object: {}",
                std::io::Error::last_os_error()
            ));
        }

        let process = unsafe {
            OpenProcess(
                PROCESS_SET_QUOTA | PROCESS_TERMINATE,
                0,
                process_id,
            )
        };
        if process.is_null() {
            return Err(format!(
                "open child process for Windows Job Object: {}",
                std::io::Error::last_os_error()
            ));
        }
        let process = unsafe { OwnedHandle::from_raw_handle(process) };
        let assigned =
            unsafe { AssignProcessToJobObject(job.as_raw_handle(), process.as_raw_handle()) };
        if assigned == 0 {
            return Err(format!(
                "assign child process to Windows Job Object: {}",
                std::io::Error::last_os_error()
            ));
        }

        Ok(Self { job })
    }

    pub fn terminate(&self) -> Result<(), String> {
        let terminated = unsafe { TerminateJobObject(self.job.as_raw_handle(), 1) };
        if terminated == 0 {
            return Err(format!(
                "terminate Windows Job Object: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "windows")]
    #[test]
    fn terminate_stops_the_attached_process() {
        use std::process::Command;
        use std::time::Duration;
        use wait_timeout::ChildExt;

        let mut child = Command::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 30",
            ])
            .spawn()
            .expect("spawn lifecycle test process");
        let process_tree =
            super::StockProcessTree::attach(child.id()).expect("attach process to Job Object");

        process_tree.terminate().expect("terminate Job Object");

        let status = child
            .wait_timeout(Duration::from_secs(5))
            .expect("wait for lifecycle test process");
        assert!(status.is_some(), "Job Object cleanup must terminate the process");
    }
}
