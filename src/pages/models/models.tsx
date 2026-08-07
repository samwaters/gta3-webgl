import { Sidebar } from "../../components/sidebar/sidebar"
import { PageLayout } from "../../components/layout/page"
import { useEffect } from "react"
import { useAppDispatch, useAppSelector } from "../../store/hooks"
import { clearModels, loadModels, modelsSelector, selectModel } from "../../store/models/models.slice"
import { FolderTree } from "../../components/foldertree/foldertree"
import { SidebarHeader } from "../../components/sidebar/header"
import { ModelViewer } from "../../components/modelviewer/modelviewer.tsx"

export const Models = () => {
    const dispatch = useAppDispatch()
    const { loading, models, selectedFile, selectedPath } = useAppSelector(modelsSelector)
    useEffect (() => {
        dispatch(loadModels())
        return () => {
            dispatch(clearModels())
        }
    }, []);

    const handleSelect = ({file, name, path}: { file: string, name: string, path: string}) => {
        dispatch(selectModel({ file, name, path }))
    }

  return (
    <PageLayout>
      <Sidebar>
          <SidebarHeader>Models</SidebarHeader>
          <FolderTree data={models} loading={loading} onSelect={handleSelect} selected={`${selectedPath}/${selectedFile}`} />
      </Sidebar>
      <ModelViewer />
    </PageLayout>
  )
}
