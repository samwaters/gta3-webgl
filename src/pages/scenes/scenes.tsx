import { Sidebar } from "../../components/sidebar/sidebar"
import { PageLayout } from "../../components/layout/page"
import { useEffect } from "react"
import { useAppDispatch, useAppSelector } from "../../store/hooks"
import {
  clearScenes,
  loadScenes,
  scenesSelector,
  selectScene,
} from "../../store/scenes/scenes.slice"
import { FolderTree } from "../../components/foldertree/foldertree"
import { SidebarHeader } from "../../components/sidebar/header"
import { SceneViewer } from "../../components/sceneviewer/sceneviewer"

export const Scenes = () => {
  const dispatch = useAppDispatch()
  const { loading, scenes, selectedFile, selectedPath } =
    useAppSelector(scenesSelector)
  useEffect(() => {
    dispatch(loadScenes())
    return () => {
      dispatch(clearScenes())
    }
  }, [])

  const handleSelect = ({
    file,
    name,
    path,
  }: {
    file: string
    name: string
    path: string
  }) => {
    dispatch(selectScene({ file, name, path }))
  }

  return (
    <PageLayout>
      <Sidebar>
        <SidebarHeader>Scenes</SidebarHeader>
        <FolderTree
          data={scenes}
          loading={loading}
          onSelect={handleSelect}
          selected={`${selectedPath}/${selectedFile}`}
        />
      </Sidebar>
      <SceneViewer />
    </PageLayout>
  )
}
