import { GlauxWorkbench } from "@/components/glaux-workbench";
import { getProjectStarCount } from "@/lib/github-repository";

export default async function Home() {
  const githubStarCount = await getProjectStarCount();
  return <GlauxWorkbench githubStarCount={githubStarCount} />;
}
